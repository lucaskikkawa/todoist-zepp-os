import { checksum } from '../shared/storage/integrity.js';
import { PROTOCOL_VERSION } from '../shared/adapters/device-sync.js';

/** Pull-based application protocol; a restarted Side Service discards only its staging snapshot. */
export function createBridge({ coordinator, store, settings, now = () => Date.now() }) {
  let snapshot = null;
  let counter = 0;
  let busy = false;
  const saveStatus = (value) => settings.setItem('pulso.status', value);
  function publish(accountId) {
    const records = store.list().filter((record) => record.accountId === accountId && ['conflict', 'blocked_recurring'].includes(record.result.state));
    settings.setItem('pulso.pending', JSON.stringify(records.map((record) => ({ accountId, uuid: record.uuid, taskId: record.taskId, state: record.result.state, code: record.result.code }))));
  }
  return {
    async handle({ method, params = {} }) {
      if (params.protocol !== PROTOCOL_VERSION) throw new Error('PROTOCOL_MISMATCH');
      if (busy) throw new Error('SYNC_BUSY');
      busy = true;
      try {
        if (method === 'pulso.identify') {
          const result = await coordinator.identify();
          saveStatus('Conta conectada. Sincronização em andamento.');
          publish(result.accountId);
          return result;
        }
        if (!params.accountId || typeof params.accountId !== 'string') throw new Error('ACCOUNT_MISMATCH');
        if (method === 'pulso.operation') {
          const results = await coordinator.processOperations(params.accountId, [params.operation]);
          publish(params.accountId);
          return { results };
        }
        if (method === 'pulso.snapshot') {
          const data = await coordinator.pullTasks(params.accountId);
          const blocks = [];
          let block = []; let chars = 0;
          for (const task of data.tasks) {
            const size = JSON.stringify(task).length;
            if (block.length && (block.length >= 20 || chars + size > 6000)) { blocks.push(block); block = []; chars = 0; }
            block.push(task); chars += size;
          }
          if (block.length) blocks.push(block);
          snapshot = { id: `g${now().toString(36)}-${++counter}`, accountId: data.accountId, syncedAt: data.syncedAt, count: data.tasks.length, blockCount: blocks.length, blocks };
          const { blocks: ignored, ...manifest } = snapshot;
          return manifest;
        }
        if (method === 'pulso.block') {
          if (!snapshot || snapshot.id !== params.id || snapshot.accountId !== params.accountId || !Number.isInteger(params.index) || !snapshot.blocks[params.index]) throw new Error('SNAPSHOT_EXPIRED');
          const tasks = snapshot.blocks[params.index];
          return { id: snapshot.id, index: params.index, tasks, checksum: checksum(JSON.stringify(tasks)) };
        }
        if (method === 'pulso.installed') {
          if (!snapshot || params.id !== snapshot.id || params.accountId !== snapshot.accountId) throw new Error('SNAPSHOT_EXPIRED');
          saveStatus(`Sincronização completa: ${snapshot.count} tarefas. ${snapshot.syncedAt}`);
          snapshot = null;
          return { ok: true };
        }
        throw new Error('UNKNOWN_METHOD');
      } finally { busy = false; }
    },
    resolve(accountId, uuid) { const result = coordinator.resolve(accountId, uuid); publish(accountId); return result; },
    failed() { saveStatus('Sincronização interrompida. Cache e conclusões permanecem no relógio. Confira token, Bluetooth e internet.'); }
  };
}
