import { BaseSideService, settingsLib } from '@zeppos/zml/base-side';
import { TodoistClient } from './todoist-client.js';
import { OperationStore } from './operation-store.js';
import { SyncCoordinator } from './sync-coordinator.js';
import { createBridge } from './bridge.js';

AppSideService(BaseSideService({
  onInit() {
    this.bridge = null;
    this.initializationError = false;
    try {
      const store = new OperationStore(settingsLib);
      const client = new TodoistClient({
        getToken: () => settingsLib.getItem('pulso.token'),
        // Zepp fetch takes one object and returns body (JSON string or object).
        fetch: (url, options) => this.fetch({ url, ...options }).then((response) => ({
          status: response.status,
          headers: response.headers,
          json: () => Promise.resolve(typeof response.body === 'string' ? JSON.parse(response.body) : response.body)
        }))
      });
      this.bridge = createBridge({ coordinator: new SyncCoordinator({ client, store }), store, settings: settingsLib });
    } catch { this.initializationError = true; settingsLib.setItem('pulso.status', 'Não foi possível abrir o registro do celular. Nenhum registro foi apagado.'); }
  },
  onRequest(request, reply) {
    if (!this.bridge) { reply(null, { error: 'SIDE_STORE_CORRUPT' }); return; }
    this.bridge.handle(request).then((result) => reply(null, result)).catch((error) => {
      this.bridge.failed();
      // Whitelist errors: neither arbitrary fetch text nor credentials cross BLE.
      const known = ['TOKEN_MISSING', 'AUTH', 'RATE_LIMIT', 'TEMPORARY', 'NETWORK', 'ACCOUNT_MISMATCH', 'PROTOCOL_MISMATCH', 'SNAPSHOT_EXPIRED', 'SYNC_BUSY', 'SIDE_STORE_WRITE', 'INVALID_RESPONSE', 'INVALID_OPERATION', 'UUID_REUSED'];
      const code = error && (error.code || error.message);
      reply(null, { error: known.includes(code) ? code : 'SYNC_FAILED' });
    });
  },
  onSettingsChange({ key, newValue }) {
    if (key !== 'pulso.resolve' || !newValue || !this.bridge) return;
    try {
      const { accountId, uuid } = JSON.parse(newValue);
      this.bridge.resolve(accountId, uuid);
      settingsLib.removeItem('pulso.resolve');
      settingsLib.setItem('pulso.status', 'Pendência mantida como histórico local. Sincronize o relógio para usar os dados atuais do Todoist.');
    } catch { settingsLib.setItem('pulso.status', 'Não foi possível resolver a pendência. Sincronize e tente novamente.'); }
  }
}));
