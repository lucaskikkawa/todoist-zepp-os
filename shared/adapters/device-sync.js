import { checksum } from '../storage/integrity.js';
export const PROTOCOL_VERSION = 1;

// The transport carries domain data only; HTTPS and authentication stay on phone.
export function synchronizeDevice(store, request, onProgress = () => {}) {
  let accountId;
  const metadata = store.metadata();
  const call = (method, params = {}) => request({ method, params: { protocol: PROTOCOL_VERSION, ...params } }).then((response) => {
    if (!response || response.error) {
      const error = new Error(response && response.error || 'INVALID_RESPONSE');
      error.code = error.message; throw error;
    }
    return response;
  });
  onProgress('Conectando ao Zepp…');
  return call('pulso.identify').then((identity) => {
    if (metadata.accountId && metadata.accountId !== identity.accountId) throw new Error('ACCOUNT_MISMATCH');
    accountId = identity.accountId;
    // Snapshot operations; completions created later remain in the journal.
    const operations = store.pendingOperations();
    let chain = Promise.resolve();
    operations.forEach((operation, index) => {
      chain = chain.then(() => {
        onProgress(`Pendências ${index + 1}/${operations.length}`);
        return call('pulso.operation', { accountId, operation }).then(({ results }) => store.applyResults(results));
      });
    });
    return chain;
  }).then(() => {
    onProgress('Baixando tarefas…');
    return call('pulso.snapshot', { accountId });
  }).then((manifest) => {
    if (manifest.accountId !== accountId) throw new Error('ACCOUNT_MISMATCH');
    store.beginGeneration(manifest);
    let chain = Promise.resolve();
    for (let index = 0; index < manifest.blockCount; index += 1) {
      chain = chain.then(() => call('pulso.block', { accountId, id: manifest.id, index })).then((block) => {
        if (block.id !== manifest.id || block.index !== index || checksum(JSON.stringify(block.tasks)) !== block.checksum) throw new Error('INVALID_BLOCK');
        store.stageBlock(manifest.id, index, block.tasks);
        onProgress(`Recebendo ${index + 1}/${manifest.blockCount}`);
      });
    }
    return chain.then(() => {
      const result = store.activateGeneration(manifest.id);
      // A lost phone ACK must never roll back a verified local generation.
      return call('pulso.installed', { accountId, id: manifest.id }).catch(() => null).then(() => result);
    });
  });
}
