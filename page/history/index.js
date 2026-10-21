import { BasePage } from '@zeppos/zml/base-page';
import { back } from '@zos/router';
import { button, colors, footer, header, states, storageReady, text } from '../ui.js';
Page(BasePage({
  onInit() { this.offset = 0; this.widgets = []; },
  build() { this.draw(); },
  draw() {
    const store = storageReady(this); if (!store) return;
    const events = store.history({ offset: this.offset, limit: 9 });
    let y = header(this, 'Histórico local');
    if (store.metadata().readOnly) y = text(this, 'Histórico indisponível nesta sessão. Arquivos preservados para recuperação.', y, { color: colors.orange });
    else if (!events.length) y = text(this, 'As conclusões salvas aparecerão aqui.', y);
    events.slice(0, 8).forEach((event) => {
      y = text(this, event.title, y, { text_size: 24 });
      y = text(this, `${event.completedAt.replace('T', ' ').slice(0, 19)} UTC\nDia local: ${event.localDate}\n${event.timezone || ''}\n${states[event.state] || event.state}`, y, { text_size: 19, color: colors.muted }) + 16;
    });
    if (this.offset) y = button(this, '‹ Anteriores', y, () => { this.offset -= 8; this.draw(); });
    if (events.length > 8) y = button(this, 'Mais antigas ›', y, () => { this.offset += 8; this.draw(); });
    y = button(this, 'Voltar', y, () => back()); footer(this, y);
  }
}));
