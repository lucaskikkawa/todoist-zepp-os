import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceStore } from '../../shared/domain/device-store.js';
import { synchronizeDevice } from '../../shared/adapters/device-sync.js';
import { checksum } from '../../shared/storage/integrity.js';

function setup() {
  const files = new Map(); let uuid = 0;
  const fs = { read: (name) => files.get(name) ?? null, write: (name, raw) => files.set(name, raw), remove: (name) => files.delete(name) };
  const store = createDeviceStore(fs, { now: () => new Date('2026-10-20T12:00:00Z'), uuid: () => `qa-${++uuid}` });
  store.beginGeneration({ id: 'old', accountId: 'a', blockCount: 1, count: 2 });
  store.stageBlock('old', 0, [{ id: '1', content: 'Antiga 1' }, { id: '2', content: 'Antiga 2' }]);
  store.activateGeneration('old');
  return { store, fs };
}
function remote({ fault, accountId = 'a', onCall = () => {} } = {}) {
  const blocks = [[{ id: '1', content: 'Antiga 1' }], [{ id: '2', content: 'Antiga 2' }]];
  return async ({ method, params }) => {
    assert.equal(params.protocol, 1);
    onCall(method, params);
    if (fault) { const response = fault(method, params); if (response) return response; }
    if (method === 'pulso.identify') return { accountId };
    if (method === 'pulso.operation') return { results: [{ uuid: params.operation.uuid, state: 'confirmed' }] };
    if (method === 'pulso.snapshot') return { id: 'new', accountId, blockCount: 2, count: 2, syncedAt: '2026-10-21T12:00:00Z' };
    if (method === 'pulso.block') return { id: 'new', index: params.index, tasks: blocks[params.index], checksum: checksum(JSON.stringify(blocks[params.index])) };
    if (method === 'pulso.installed') return {};
    throw Error('UNEXPECTED_METHOD');
  };
}

test('QA transport mock: Bluetooth loss in second block preserves complete previous generation after restart', async () => {
  const { store, fs } = setup();
  await assert.rejects(synchronizeDevice(store, remote({ fault: (method, params) => {
    if (method === 'pulso.block' && params.index === 1) throw Error('SIMULATED_BLUETOOTH_DISCONNECT');
  } })), /SIMULATED_BLUETOOTH_DISCONNECT/);
  const recovered = createDeviceStore(fs);
  assert.equal(recovered.metadata().generation, 'old');
  assert.equal(recovered.metadata().lastSync, '2026-10-20T12:00:00.000Z');
  assert.equal(recovered.listTasks().total, 2);
});

test('QA transport mock: bad block checksum is rejected before cache activation', async () => {
  const { store } = setup();
  await assert.rejects(synchronizeDevice(store, remote({ fault: (method) => method === 'pulso.block'
    ? { id: 'new', index: 0, tasks: [{ id: '3', content: 'Tampered' }], checksum: 'bad' } : null })), /INVALID_BLOCK/);
  assert.equal(store.metadata().generation, 'old');
});

test('QA transport mock: account mismatch stops before uploading any pending operation', async () => {
  const { store } = setup(); store.completeTask('1'); const methods = [];
  await assert.rejects(synchronizeDevice(store, remote({ accountId: 'b', onCall: (method) => methods.push(method) })), /ACCOUNT_MISMATCH/);
  assert.deepEqual(methods, ['pulso.identify']);
  assert.equal(store.pendingOperations().length, 1);
});

test('QA transport mock: completion made during transfer survives snapshot install', async () => {
  const { store, fs } = setup();
  await synchronizeDevice(store, remote({ onCall: (method, params) => {
    if (method === 'pulso.block' && params.index === 0) store.completeTask('2');
  } }));
  const recovered = createDeviceStore(fs);
  assert.equal(recovered.metadata().generation, 'new');
  assert.equal(recovered.pendingOperations().length, 1);
  assert.equal(recovered.getTask('2'), null);
  assert.equal(recovered.getTask('1').id, '1');
});

test('QA transport mock: lost final phone acknowledgement cannot roll back verified installed cache', async () => {
  const { store, fs } = setup();
  await synchronizeDevice(store, remote({ fault: (method) => {
    if (method === 'pulso.installed') throw Error('SIMULATED_FINAL_ACK_LOSS');
  } }));
  assert.equal(createDeviceStore(fs).metadata().generation, 'new');
});
