import { BasePage } from '@zeppos/zml/base-page';
import { back } from '@zos/router';
import { button, colors, footer, header, short, states, storageReady, text } from '../ui.js';
Page(BasePage({
  onInit() { this.offset = 0; this.widgets = []; },
  build() { this.draw(); },
  draw() {
    const store = storageReady(this); if (!store) return;
    const operations = store.pendingOperations();
    let y = header(this, 'Pendências', `${operations.length} registros preservados`);
    if (store.metadata().readOnly) y = text(this, 'Fila indisponível para leitura. Os arquivos foram preservados. Nenhuma conclusão pode ser confirmada nesta sessão.', y, { color: colors.orange });
    else if (!operations.length) y = text(this, 'Nenhuma conclusão pendente.', y);
    operations.slice(this.offset, this.offset + 8).forEach((op) => {
      y = text(this, short(op.baseTask.title, 80), y, { text_size: 24 });
      y = text(this, states[op.state] || op.state, y, { text_size: 20, color: colors.orange }) + 16;
    });
    if (operations.length) y = text(this, 'Sincronize pela tela inicial. Resolva conflitos nas configurações do Pulso no Zepp.', y, { text_size: 21, color: colors.muted });
    if (this.offset) y = button(this, '‹ Anteriores', y, () => { this.offset -= 8; this.draw(); });
    if (this.offset + 8 < operations.length) y = button(this, 'Próximas ›', y, () => { this.offset += 8; this.draw(); });
    y = button(this, 'Voltar', y, () => back()); footer(this, y);
  }
}));
