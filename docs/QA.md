# QA independente — Pulso 0.1.0

Responsabilidade: revisão independente da implementação, testes adicionais de falha e conferência do pacote. Ambiente Cloud sem relógio, Bluetooth ou conta Todoist real. Dados usados nos testes são sintéticos. O executor Node e mocks não equivalem ao runtime Zepp OS.

## Critérios de revisão

| Área | Critério |
| --- | --- |
| Cache | Todas as páginas, tarefas futuras distantes e sem data; geração parcial nunca ativa. |
| Persistência | Conclusão verificada antes de sucesso; reinício recupera cache e operações; corrupção nunca resulta em limpeza silenciosa. |
| Reenvio | UUID e argumentos persistentes; uma resposta perdida não cria nova conclusão. |
| Conta | Identidade verificada antes de enviar operações; cache antigo não autoriza escrever em conta diferente. |
| Conflitos | Tarefa ausente/alterada e relações pai/filho não geram sucesso presumido. |
| Recorrências | Sete eventos diários distintos, horário original retido; regra desconhecida não avança; replay remoto bloqueado. |
| Rede | Bluetooth, HTTP temporário, rate limit e sucesso parcial preservam consulta local. |
| Segurança | Token somente no Settings Storage do telefone; sem token ou títulos de tarefas nos logs. |
| Volume | 100, 1.000 e 5.000 tarefas são cargas de teste, não limites do produto. |

## Resultados automatizados

Execução independente de `npm test`: **80 testes aprovados, zero falhas** no conjunto integrado disponível durante esta revisão. `npm run lint`: **aprovado** (sintaxe JavaScript e política de ausência de logs no código do aplicativo). Execução repetida após as últimas proteções de UUID e conflito; todos os 80 casos passaram.

Os 18 testes independentes de `tests/qa/` cobrem:

- Corrupção de cada cópia da fila após sucesso; interrupção na primeira e segunda escrita; corrupção de ambas falhando explicitamente sem apagar arquivos.
- Transferência interrompida, checksum inválido, recuperação da geração anterior e conta incompatível.
- Nova conclusão durante transferência e perda do ACK final sem rollback do cache instalado.
- Sete ocorrências diárias com UTC/data local originais, sem comando remoto de recorrência.
- Carregamento dos entrypoints reais App, quatro Pages, Settings e Side em **host Node com APIs Zepp/ZML simuladas**; consulta, conclusão, histórico, envio comum e resolução explícita de pendência recorrente.
- Token ausente dos arquivos do relógio e do conteúdo renderizado nas configurações após salvar; rascunho em memória só substitui o token persistido após o botão explícito de salvar.
- Fila totalmente corrompida abre cache bruto somente para leitura; nenhuma conclusão, sincronização ou remoção de arquivo é permitida nesse modo.

Os testes dos desenvolvedores complementam a revisão com paginação HTTP simulada, resposta de escrita perdida, reenvio do mesmo UUID, sucesso parcial, filhos antes de pai, falha de autenticação, espera global de rate limit e cargas de 100/1.000/5.000 tarefas. Em uma execução independente, o caso de 5.000 tarefas de cache concluiu em aproximadamente 44 ms no Node do Cloud e persistiu 864.261 unidades UTF-16 no filesystem simulado. Isso **não mede** bytes reais no Bip 6, tempo de flash, memória do relógio ou latência Bluetooth.

## Defeitos encontrados e tratados

- A recuperação de snapshots interrompidos deixava blocos órfãos; o desenvolvedor acrescentou descritor persistente de staging e limpeza da transferência anterior sem remover gerações já ativadas.
- Uma mudança para permitir reabertura remota de tarefas fez um snapshot anterior ao ACK reaparecer como ativo. A execução independente detectou a regressão; a correção preserva o overlay quando a revisão é igual e reconhece mudança de revisão ou ausência seguida de reaparecimento. O teste original foi mantido.
- Mensagens de interface não mapeavam os códigos reais `AUTH`/`RATE_LIMIT`; os códigos e as instruções em português foram corrigidos.
- Identificadores de evento/operação agora são comparados com o histórico persistido antes de qualquer gravação; colisões e geradores inválidos falham explicitamente sem alterar arquivos.
- Uma pendência marcada como conflito no relógio permanece bloqueada mesmo se o diário do telefone for recriado; estados desconhecidos são rejeitados, e resultados terminais preservam o bloqueio de dependências.
- O token era persistido diretamente em `onChange`, enquanto o framework pode redesenhar a tela a cada mudança de Settings Storage. A configuração agora usa rascunho em memória e botão explícito de salvar, verificado no smoke test.

## Compilação

**Compilação independente aprovada**, exit 0, por `npm run build` com o compilador oficial **`@zeppos/zpm` 3.1.5**, fixado no lockfile. O processo executou Rollup em sete entrypoints, conversão do ícone e QJSC em cinco arquivos do relógio. O script cria uma árvore de produção explícita para excluir testes, documentação e ferramentas do pacote. O compilador não foi modificado.

Artefato final inspecionado após as últimas correções: `dist/Pulso-0.1.0-20261020171458.zab`, **63.761 bytes**, SHA-256 `2670d59ab4e51e4fd718a63be45ef7a139a14408223f00915e17daf468a579f7`. Novas compilações alteram nome, timestamp e hash do arquivo.

A inspeção independente `python3 tests/qa/verify-artifact.py dist/*.zab` verificou integridade do ZPK pelo MD5 declarado no ZAB, variantes Bip 6 9765120/9765121/10158337, appId 1052671, versão 0.1.0, API_LEVEL mínimo 4.2 e loader binário `runtime.type: 2`. A permissão declarada `data:os.device.info`, necessária à camada de compatibilidade ZML, também corresponde ao manifesto de origem. O pacote contém `app.bin` e as quatro páginas `.bin`; `app-side.js` e `setting.js` ficam no pacote do telefone. Os binários do relógio não contêm o endpoint Todoist, a chave de token, prefixo Bearer ou fixtures de testes. Testes, scripts e documentação não são enviados ao dispositivo.

A tentativa inicial pelo **Zeus CLI 1.9.3** (fluxo hoje exposto como `npm run build:zeus`) falhou com `403 Domain forbidden` no catálogo obrigatório `upload-cdn.zepp.com`. Isso não foi contornado por mudança de proxy, cache forjado ou compilador alterado: o caminho local usa outro lançamento oficial do compilador, disponível no npm e capaz de compilar sem essa consulta. Preview/QR autenticado não foi executado.

## Parecer

Os contratos de persistência, consulta offline e envio comum passaram pelos testes locais revisados, inclusive falhas injetadas. A compilação real e a estrutura do artefato foram verificadas; a entrega é adequada à **validação física preliminar**, que permanece pendente. A revisão não aprova suporte retroativo completo a recorrências nem execução física do aplicativo. Não houve autenticação em conta Todoist real, integração Bluetooth real, execução no simulador Zepp ou instalação no Bip 6.

## Testes físicos pendentes

Todos os passos físicos de [TECHNICAL-VALIDATION.md](TECHNICAL-VALIDATION.md) permanecem pendentes até execução no Bip 6. Em particular, recuperação após perda de energia, capacidade de flash/memória, horário local real, transferência Bluetooth e suspensão do Zepp Android precisam de evidência no dispositivo.
