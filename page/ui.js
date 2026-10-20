import { createWidget, deleteWidget, widget, align, text_style, getTextLayout } from '@zos/ui';
export const colors = { bg: 0x0b1117, panel: 0x1c2935, green: 0x59e0a4, ink: 0xf3f6f8, muted: 0xadb9c5, orange: 0xffc36b };
export function appData() { return getApp()._options.globalData; }
export function clear(page) { (page.widgets || []).forEach((item) => deleteWidget(item)); page.widgets = []; }
function add(page, type, props) { const item = createWidget(type, props); page.widgets.push(item); return item; }
export function text(page, value, y, options = {}) {
  const opts = { x: 28, w: 334, text_size: 24, color: colors.ink, align_h: align.LEFT, align_v: align.CENTER_V, text_style: text_style.WRAP, ...options };
  const h = opts.h || Math.max(36, getTextLayout(String(value), { text_size: opts.text_size, text_width: opts.w, wrapped: 1 }).height + 12);
  add(page, widget.TEXT, { ...opts, y, h, text: String(value) });
  return y + h;
}
export function button(page, label, y, click, options = {}) {
  add(page, widget.BUTTON, { x: 28, y, w: 334, h: 52, radius: 14, text_size: 23, color: colors.ink,
    normal_color: colors.panel, press_color: 0x355144, text: label, click_func: click, ...options });
  return y + (options.h || 52) + 10;
}
export function header(page, title, subtitle = '') {
  clear(page);
  text(page, title, 30, { text_size: 30, color: colors.green, h: 44 });
  return subtitle ? text(page, subtitle, 78, { text_size: 20, color: colors.muted }) + 12 : 92;
}
export function footer(page, y) { text(page, 'Pulso • 0.1.0', y + 8, { text_size: 18, color: colors.muted, h: 42 }); }
export function storageReady(page) {
  const data = appData();
  if (data.store) return data.store;
  const y = header(page, 'Dados protegidos');
  text(page, 'Não foi possível ler o armazenamento. Nenhum arquivo foi apagado. Reabra o aplicativo; preserve os dados antes de reinstalar.', y);
  return null;
}
const messages = {
  UUID_COLLISION: 'Não foi possível criar um identificador seguro. Nenhuma conclusão nova foi salva. Reabra o aplicativo.',
  READ_ONLY_CACHE: 'Somente consulta. Preserve os arquivos para recuperar a fila.',
  ACCOUNT_MISMATCH: 'Conta diferente. Os dados e as pendências da conta anterior foram preservados.',
  AUTH: 'Token inválido. Corrija nas configurações do Zepp.',
  RATE_LIMIT: 'Limite temporário da API. Aguarde antes de sincronizar.',
  SIDE_STORE_CORRUPT: 'Registro do celular indisponível. Seus dados locais estão preservados.',
  AUTH_REQUIRED: 'Configure o token nas configurações do Pulso no Zepp.',
  AUTH_INVALID: 'Token inválido. Corrija nas configurações do Zepp.',
  UNAUTHORIZED: 'Token inválido. Corrija nas configurações do Zepp.',
  HAS_ACTIVE_SUBTASKS: 'Conclua as subtarefas primeiro.',
  STORAGE_WRITE_FAILED: 'Falha ao salvar. Confira o histórico antes de tentar novamente.',
  QUEUE_CORRUPT: 'Fila danificada. Preserve os arquivos; nenhuma pendência foi apagada.',
  CACHE_CORRUPT: 'Cache danificado. Tente sincronizar novamente.',
  RATE_LIMITED: 'Limite temporário da API. Aguarde antes de sincronizar.',
  TOKEN_MISSING: 'Configure o token nas configurações do Pulso no Zepp.'
};
export function errorMessage(error) { return messages[error && (error.code || error.message)] || 'Sem conexão com o Zepp ou a internet. Os dados locais continuam disponíveis. Tente sincronizar depois.'; }
export function short(value, max = 30) { return String(value || '').length > max ? `${String(value).slice(0, max - 1)}…` : String(value || ''); }
export const states = { pending: 'A enviar', retry: 'Tentar depois', conflict: 'Conflito — veja o Zepp', blocked_recurring: 'Recorrência: só no relógio', confirmed: 'Confirmada no Todoist', resolved: 'Resolvida no Zepp', unknown: 'Não confirmada' };
