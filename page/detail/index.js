import { BasePage } from '@zeppos/zml/base-page';
import { back } from '@zos/router';
import { watchContext } from '../../shared/adapters/watch-clock.js';
import { button, colors, errorMessage, footer, header, storageReady, text } from '../ui.js';
Page(BasePage({
  onInit(params) { const value = typeof params === 'string' ? JSON.parse(params || '{}') : params || {}; this.taskId = value.id; this.widgets = []; },
  build() { this.draw(); },
  draw() {
    const store = storageReady(this); if (!store) return;
    const task = store.getTask(this.taskId);
    let y = header(this, 'Tarefa');
    if (this.notice) y = text(this, this.notice, y, { color: colors.orange, text_size: 22 }) + 10;
    if (!task || this.completed) {
      if (!this.notice) y = text(this, 'Conclusão salva no relógio. Veja o histórico para acompanhar o envio.', y);
      y = button(this, 'Voltar', y + 12, () => back()); footer(this, y); return;
    }
    y = text(this, task.title, y, { text_size: 28 }) + 12;
    y = text(this, `Projeto: ${task.projectName || task.projectId || 'Caixa de entrada'}\nPrioridade: ${5 - task.priority}${task.parentId ? '\nSubtarefa' : ''}`, y, { text_size: 21, color: colors.muted }) + 12;
    y = text(this, task.due ? `Vencimento: ${task.due.datetime || task.due.date}\n${task.due.string || ''}` : 'Sem data', y, { text_size: 22 }) + 12;
    if (task.due && task.due.is_recurring) y = text(this, 'Recorrente: a conclusão fica no histórico local. O envio ao Todoist está bloqueado nesta versão.', y, { color: colors.orange, text_size: 21 }) + 12;
    if (store.metadata().readOnly) y = text(this, 'Somente consulta. A fila precisa ser recuperada antes de registrar conclusões.', y, { color: colors.orange, text_size: 22 });
    else y = button(this, 'Concluir', y, () => {
      try {
        store.completeTask(this.taskId, watchContext()); this.completed = true;
        this.notice = 'Conclusão salva no relógio.';
      } catch (error) { this.notice = errorMessage(error); }
      this.draw();
    }, { normal_color: 0x16553b, press_color: 0x287955 });
    y = button(this, 'Voltar', y, () => back()); footer(this, y);
  }
}));
