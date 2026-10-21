# Arquitetura, durabilidade e sincronização

## Componentes

`app.js` carrega o armazenamento antes de qualquer rede. `page/{tasks,detail,pending,history}` usa widgets nativos Zepp em pt-BR, com paginação local de oito itens por tela. Detalhes e histórico permitem ler o título completo. `shared/domain`, `storage` e `recurrence` não dependem do Zepp. `shared/adapters` isola filesystem, relógio e transporte ZML.

`app-side/index.js` adapta a resposta `fetch` do Zepp para o cliente HTTP. `todoist-client.js`, `operation-store.js` e `sync-coordinator.js` fazem autenticação, paginação, journal e conflitos. `bridge.js` coordena a sessão e fornece blocos. `setting/index.js` recebe token, mostra estado e oferece resolução local explícita. Não há backend próprio.

## Persistência

As tarefas são arquivos `tasks-<generation>-<index>.json`, com envelope de payload e checksum FNV-1a (detecção de corrupção, não criptografia). `tasks-a.json` e `tasks-b.json` guardam manifestos com sequência, conta, contagens, blocos e última sincronização. A ativação exige todos os blocos íntegros e IDs únicos. O manifesto só muda após validação e releitura de gravação. A geração anterior continua disponível; a terceira geração substituída é removida depois da confirmação. `tasks-staging.json` permite limpar arquivos de uma transferência interrompida sem tocar nas duas gerações confirmadas.

`queue-a.json` e `queue-b.json` recebem, sequencialmente, o mesmo journal com sequência crescente. Cada gravação é relida e verificada. Um sucesso exibido pressupõe os dois espelhos verificados. Se a segunda gravação falhar, a primeira poderá já conter o evento: a interface avisa erro e o próximo toque/reinício deduplica pelo evento existente. Nenhuma falha deve resultar em uma nova operação equivalente.

Eventos de conclusão e comandos são registros separados. Eventos preservam título, ocorrência original, instante UTC, data local, offset/fuso e próximo vencimento local quando suportado. Operações preservam UUID, comando/argumentos, baseline e resultado. Confirmar no servidor altera o estado, sem remover o histórico. Resolução explícita também mantém o evento original.

No celular, `OperationStore` verifica dois espelhos no Settings Storage antes de envio e ACK. Não há `fsync` ou transação multiarquivo documentada no Zepp: verificação de leitura e testes simulados não substituem reinício/queda de energia no hardware.

## Protocolo v1

Todas as mensagens incluem `params.protocol=1`.

1. `pulso.identify`: identifica a conta autenticada. Conta diferente bloqueia o processo antes de enviar pendências.
2. `pulso.operation`: uma operação por solicitação; o Side Service verifica/persiste antes de enviar e devolve resultado persistido. O relógio grava cada resultado antes de continuar. Operações novas criadas durante a sincronização não entram no snapshot da fila em andamento.
3. `pulso.snapshot`: lê todas as páginas de projetos/tarefas ativas. Só depois da leitura completa disponibiliza `{id,accountId,count,blockCount,syncedAt}`.
4. `pulso.block`: solicita bloco numerado da mesma conta/geração; resposta inclui tarefas e checksum. Blocos têm até 20 tarefas e aproximadamente 6.000 unidades UTF-16, exceto tarefa individual maior. A fragmentação Bluetooth é da ZML, não um limite de tarefas do produto.
5. O relógio verifica o checksum recebido, persiste e relê blocos; valida contagens/duplicatas antes de ativar o manifesto.
6. `pulso.installed`: libera a cópia transitória no celular e atualiza estado das configurações. ACK perdido aqui não desfaz cache já instalado.

Após reinício do Side Service, snapshot transitório pode expirar: repetir toda a leitura na próxima sessão, sem substituir o cache anterior. Última sincronização só muda após ativação completa no relógio. A v0.1 sincroniza por ação manual; reconexão Bluetooth isolada não dispara trabalho garantido em segundo plano.

## Segurança de escrita e conflitos

Antes do primeiro comando comum: verificar conta, buscar tarefa e conjunto ativo, comparar revisão, título, projeto, pai, prioridade e vencimento. Pais com filhos ativos são bloqueados. Uma operação já marcada como enviada repete exatamente UUID/payload após resposta ambígua; não usa `404` como prova de sucesso. A deduplicação efetiva é da API pública Todoist.

A API não documenta compare-and-swap para esse comando. Uma alteração remota entre consulta e escrita ainda pode ocorrer. Uma consulta REST paginada também não fornece snapshot transacional. Essas limitações não são resolvidas por mocks ou pelo build.

Rate limit/erros temporários preservam operações com próxima tentativa; a sessão compartilha cooldown por credencial, inclusive para identificação e snapshot. Não há loop bloqueante de tentativas. Autenticação inválida bloqueia chamadas até substituir o token ou reiniciar o cliente. Mudanças de token não trocam a credencial no meio de uma requisição já iniciada; toda nova sessão confirma a conta.

Conflitos e recorrências nunca são reenviados por um novo comando inventado. A resolução nas configurações marca `resolved` apenas no journal local e o relógio recebe isso na próxima sessão. As recorrências continuam sem escrita remota; [evidências da API](TODOIST-API.md).

Concluídas comuns ficam ocultas sobre snapshots desatualizados. Uma tarefa reaberta só reaparece ao receber revisão nova ou após uma geração confirmar sua ausência e outra recebê-la novamente. Com revisão ausente e reabertura sem uma leitura intermediária, a escolha é conservadora para não exibir como aberta uma conclusão ainda presente em leitura desatualizada.

## Escala e recuperação

A lista e os detalhes leem blocos; não carregam todas as tarefas de forma permanente no relógio. A validação usa conjunto de IDs e o histórico/journal fica em memória durante uso. Não há corte por data nem limite fixo de 100/1.000/5.000 tarefas. Esses volumes são somente cargas de teste, sem equivalência a capacidade física comprovada.

A primeira operação de cada chamada ao coordenador pode exigir leitura completa das tarefas para proteger subtarefas; lotes grandes de conclusões têm custo de rede adicional na v0.1. Sob falta de capacidade, a política é falhar mantendo cache/fila anteriores, jamais truncar dados silenciosamente.
