import { BaseApp } from '@zeppos/zml/base-app';
import { createDeviceStore } from './shared/domain/device-store.js';
import { zeppFs } from './shared/adapters/zepp-fs.js';
import { watchContext } from './shared/adapters/watch-clock.js';
App(BaseApp({
  globalData: { store: null, storageError: null, syncBusy: false, syncMessage: 'Offline' },
  onCreate() {
    try { this.globalData.store = createDeviceStore(zeppFs, { now: () => new Date(watchContext().completedAt) }); }
    catch (error) {
      this.globalData.storageError = error.code || 'STORAGE_READ_FAILED';
      try { this.globalData.store = createDeviceStore(zeppFs, { readOnly: true, now: () => new Date(watchContext().completedAt) }); } catch { /* Keep damaged files for recovery. */ }
    }
  }
}));
