// Draft credentials stay only in memory until the explicit save action.
let tokenDraft = "";
AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage;
    const configured = Boolean(storage.getItem('pulso.token'));
    let pending = [];
    try { pending = JSON.parse(storage.getItem('pulso.pending') || '[]'); } catch { /* Preserve persisted data; show status. */ }
    const confirm = storage.getItem('pulso.confirmResolve');
    const children = [
      Text({ paragraph: true, bold: true }, 'Pulso • Todoist'),
      Text({ paragraph: true }, 'Todas as tarefas no relógio, inclusive futuras e sem data. Configure o token aqui e toque em Sincronizar no relógio.'),
      Text({ paragraph: true }, configured ? 'Token configurado' : 'Token não configurado'),
      TextInput({
        label: configured ? 'Substituir token pessoal' : 'Token pessoal Todoist',
        placeholder: 'Cole o token somente aqui',
        value: tokenDraft,
        onChange(value) {
          tokenDraft = typeof value === 'string' ? value : '';
        }
      }),
      Button({ label: 'Salvar token', onClick() {
        const token = tokenDraft.trim(); tokenDraft = '';
        if (token) storage.setItem('pulso.token', token);
      } }),
      Text({ paragraph: true }, 'O token é salvo no Settings Storage do Zepp. O aplicativo não o envia ao relógio nem o mostra após salvar.'),
      Button({ label: 'Remover token', onClick() { storage.removeItem('pulso.token'); } }),
      Text({ paragraph: true, bold: true }, 'Conexão e sincronização'),
      Text({ paragraph: true }, storage.getItem('pulso.status') || 'Aguardando a primeira sincronização.'),
      Text({ paragraph: true, bold: true }, `Pendências para revisão (${pending.length})`),
      Text({ paragraph: true }, 'Recorrências permanecem apenas no histórico local nesta versão. Resolver não conclui a tarefa no Todoist: preserva o registro local e permite usar novamente o estado atual do servidor.')
    ];
    pending.forEach((entry) => {
      children.push(Text({ paragraph: true }, `Tarefa ${entry.taskId}: ${entry.state === 'blocked_recurring' ? 'recorrência sem envio' : 'conflito'}`));
      if (confirm === entry.uuid) {
        children.push(Text({ paragraph: true }, 'Confirmar: manter esta conclusão apenas no histórico local e usar o estado atual do Todoist?'));
        children.push(Button({ label: 'Confirmar resolução local', onClick() {
          storage.setItem('pulso.resolve', JSON.stringify({ accountId: entry.accountId, uuid: entry.uuid }));
          storage.removeItem('pulso.confirmResolve');
        } }));
      } else children.push(Button({ label: 'Revisar e resolver', onClick() { storage.setItem('pulso.confirmResolve', entry.uuid); } }));
    });
    children.push(Text({ paragraph: true }, 'Após resolver, sincronize no relógio. Não desinstale para corrigir erros: a desinstalação apaga os dados locais.'));
    return View({ style: { padding: '20px', backgroundColor: '#101820', color: '#f3f6f8' } }, children);
  }
});
