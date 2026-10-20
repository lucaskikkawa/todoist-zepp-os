import { BasePage } from '@zeppos/zml/base-page';
import { push } from '@zos/router';
import { synchronizeDevice } from '../../shared/adapters/device-sync.js';
import { watchContext } from '../../shared/adapters/watch-clock.js';
import { appData, button, colors, errorMessage, footer, header, short, storageReady, text } from '../ui.js';
const groups = [['overdue', 'Atrasadas'], ['today', 'Hoje'], ['upcoming', 'Próximas'], ['no_date', 'Sem data']];
Page(BasePage({
  onInit() { this.group = null; this.offset = 0; this.widgets = []; this.destroyed = false; },
  build() { this.draw(); },
  onResume() { if (this.widgets && !this.destroyed) this.draw(); },
  onDestroy() { this.destroyed = true; },
  draw() {
    if (this.destroyed) return;
    const store = storageReady(this); if (!store) return;
    const data = appData(); const meta = store.metadata();
    const totalPending = store.pendingOperations().length;
    let y = header(this, 'Pulso', data.syncBusy ? data.syncMessage : `${meta.count} tarefas no cache • Offline`);
    if (this.notice) y = text(this, this.notice, y, { text_size: 20, color: colors.orange }) + 10;
    if (meta.readOnly) y = text(this, 'Somente consulta: a fila não pôde ser lida. O cache pode incluir tarefas já concluídas. Nenhum arquivo foi apagado.', y, { text_size: 20, color: colors.orange });
    if (meta.recoveryWarning) y = text(this, 'Cache recuperado. Confira a última sincronização.', y, { text_size: 20, color: colors.orange });
    if (this.group) {
      const group = groups.find(([id]) => id === this.group);
      y = button(this, `‹ Grupos • ${group[1]}`, y, () => { this.group = null; this.draw(); });
      const result = store.listTasks({ group: this.group, offset: this.offset, limit: 8, today: watchContext().localDate, timezoneOffsetMinutes: watchContext().timezoneOffsetMinutes });
      y = text(this, `${result.total} tarefas`, y, { color: colors.muted, text_size: 20 });
      result.tasks.forEach((task) => {
        y = button(this, short(task.title, 25), y, () => push({ url: 'page/detail/index', params: { id: task.id } }), { h: 62 });
      });
      if (!result.total) y = text(this, 'Nenhuma tarefa neste grupo.', y);
      if (this.offset) y = button(this, '‹ Anteriores', y, () => { this.offset = Math.max(0, this.offset - 8); this.draw(); });
      if (result.hasMore) y = button(this, 'Próximas ›', y, () => { this.offset += 8; this.draw(); });
    } else {
      if (!meta.generation) y = text(this, 'Configure o Todoist no Zepp e sincronize uma vez. Depois, consulte tudo offline.', y, { text_size: 22 });
      groups.forEach(([id, title]) => {
        y = button(this, title, y, () => { this.group = id; this.offset = 0; this.draw(); });
      });
      y = button(this, `Pendências (${totalPending})`, y, () => push({ url: 'page/pending/index' }));
      y = button(this, 'Histórico local', y, () => push({ url: 'page/history/index' }));
    }
    if (!meta.readOnly) y = button(this, data.syncBusy ? 'Sincronizando…' : 'Sincronizar', y, () => this.sync(), { color: colors.green });
    if (meta.lastSync) y = text(this, `Última sincronização completa:\n${meta.lastSync.replace('T', ' ').slice(0, 16)} UTC`, y, { color: colors.muted, text_size: 18 });
    footer(this, y);
  },
  sync() {
    const data = appData(); if (data.syncBusy || !data.store || data.store.metadata().readOnly) return;
    data.syncBusy = true; this.notice = null;
    synchronizeDevice(data.store, (message) => this.request(message), (message) => {
      data.syncMessage = message; this.draw();
    }).then(() => { this.notice = 'Sincronização completa. Cache disponível offline.'; }).catch((error) => {
      this.notice = errorMessage(error);
    }).then(() => { data.syncBusy = false; data.syncMessage = 'Offline'; this.draw(); });
  }
}));
