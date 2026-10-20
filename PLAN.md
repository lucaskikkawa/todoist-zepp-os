# Plano técnico consolidado — Todoist para Zepp OS v0.1.0

**Aplicativo (nome provisório):** Pulso  
**Relógio-alvo:** Amazfit Bip 6  
**Repositório GitHub:** `todoist-zepp-os` (privado, já criado)  
**Branch de implementação:** `feature/v0.1.0` → Pull Request para `main`  
**Estado atual:** planejamento finalizado; implementação e validação física ainda não realizadas.

## Orientações para a implementação

Este documento consolida o plano elaborado pelo Codex e as decisões tomadas posteriormente. É a referência técnica da implementação v0.1.0; o `AGENTS.md` conterá as instruções operacionais permanentes para os agentes.

- **Preservar o repositório existente:** já há Git, README e `.gitignore` inicial. Não executar `git init`, não criar outro repositório e não sobrescrever histórico ou arquivos preexistentes sem necessidade.
- **Entregar um núcleo utilizável:** sincronização de todas as tarefas ativas, cache persistente no relógio, consulta offline e registro durável de conclusões offline com sincronização segura das operações suportadas.
- **Sem limite temporal artificial:** o teste de sete dias offline não limita o conjunto de tarefas sincronizadas; incluir atrasadas, futuras distantes e sem data.
- **Recorrências com segurança:** registrar localmente ocorrências e horários originais. O histórico retroativo no Todoist continua dependente de comprovação técnica. Não inventar suporte, reprocessar às cegas ou perder registros. Essa pendência não impede disponibilizar a v0.1 **com o recurso explicitamente parcial ou limitado**.
- **Validação honesta:** separar testes automatizados, compilação, simulações e verificações no Bip 6. O ambiente Cloud não equivale a um relógio físico.
- **Segurança e autonomia:** nenhuma credencial real em Git, código, fixtures ou logs; organizar commits por marcos e abrir PR para revisão humana, **sem merge automático**.
- **Protótipo:** o relatório HTML *Pulso* é referência visual e planejamento, não um aplicativo já compilado ou evidência de compatibilidade.

---

## 1. Viabilidade e decisões estabelecidas

**O aplicativo offline é tecnicamente viável. O histórico retroativo de recorrências ainda não está comprovado.** Essa distinção determina o que pode ser implementado diretamente e o que exige uma prova de integração antes de prometer a versão completa.

Decisões já estabelecidas:

- Uso pessoal, uma conta do Todoist.
- Celular principal: Android.
- Autenticação por token pessoal configurado no Zepp.
- Consulta de todas as tarefas ativas, incluindo atrasadas, futuras e sem data.
- Funcionamento por pelo menos sete dias sem celular ou internet, com dados previamente sincronizados.
- Preservação de cada conclusão e de seu horário original.
- Sem servidor próprio, voz, notificações avançadas ou edição completa.
- GitHub privado `todoist-zepp-os` já criado; implementar em `feature/v0.1.0` e propor integração com `main` por Pull Request. O projeto poderá continuar localmente depois.

### Suporte confirmado e pontos de validação

| Tema                                      | Evidência e decisão                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bip 6                                     | A tabela oficial atual lista Zepp OS 5.0, API_LEVEL 4.2 e tela 390 × 450. O firmware real deverá ser conferido.                                            |
| Toolchain                                 | Usar Zeus CLI e APIs JavaScript `@zos/*`, com alvo API_LEVEL 4.2. A versão do CLI não corresponde numericamente ao API_LEVEL.                              |
| Persistência                              | Há armazenamento local e arquivos no relógio.                                                                                                              |
| Capacidade                                | Não encontrei nas referências consultadas uma quota oficial específica, em bytes, para o aplicativo no Bip 6. Medir capacidade e memória será obrigatório. |
| Comunicação                               | Device App ↔ Side Service por Bluetooth é documentado.                                                                                                     |
| Internet                                  | O Side Service no Zepp pode acessar serviços externos por `fetch`.                                                                                         |
| Conclusão recorrente                      | A API oferece comandos próprios para concluir e reagendar recorrências.                                                                                    |
| Histórico retroativo                      | Não está documentado um horário de conclusão no comando específico de recorrência. Não considerar suportado sem evidência.                                 |
| Sincronização automática em segundo plano | Não assumir execução imediata apenas porque o Bluetooth reconectou. Validar o ciclo real do Zepp no Android.                                               |

Fontes: [dispositivos](https://docs.zepp.com/docs/reference/related-resources/device-list/), [compatibilidade de API_LEVEL](https://docs.zepp.com/docs/guides/framework/device/compatibility/), [LocalStorage](https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/), [arquitetura Zepp](https://docs.zepp.com/docs/guides/architecture/arc/).

**Ter internet no celular, sozinho, não garante que o Bip 6 esteja atualizado.** Também são necessários comunicação Bluetooth e Side Service disponível.

## 2. Arquitetura, dados e interface

A arquitetura terá três partes, sem backend adicional:

```
Bip 6
  Interface + tarefas persistidas + fila de conclusões
                     ↕ Bluetooth
Zepp no Android
  Side Service + cliente Todoist + coordenação da sincronização
                     ↕ HTTPS
Conta Todoist

Configurações no Zepp
  Token pessoal + estado da conexão
```

Essa divisão segue a [arquitetura oficial](https://docs.zepp.com/docs/guides/architecture/arc/). Para encapsular a comunicação, usar a biblioteca oficial [ZML](https://zepp-health.github.io/zml/getting-started), isolada atrás de um adaptador do projeto.

### Responsabilidades

**Device App**

- Carregar dados locais antes de tentar sincronizar.
- Exibir tarefas e detalhes.
- Registrar conclusões imediatamente em armazenamento persistente.
- Manter a interface funcionando durante falhas de comunicação.
- Executar apenas o calendário offline que tiver suporte validado.

**Side Service**

- Autenticar chamadas ao Todoist.
- Buscar todas as páginas de tarefas.
- Enviar operações pendentes e guardar seus resultados.
- Detectar conflitos.
- Transferir os dados atualizados para o relógio.

**Settings App**

- Receber e substituir o token.
- Mostrar conexão, sincronização e conflitos.
- Permitir resolver pendências usando o estado atual do Todoist.
- Nunca reenviar uma conclusão conflitante automaticamente.

### Modelo mínimo de dados

| Registro          | Conteúdo necessário                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Tarefa            | ID como texto, título, projeto, tarefa pai, prioridade, vencimento completo, recorrência original e revisão remota   |
| Conclusão         | ID único, tarefa, ocorrência original, instante UTC, data local/fuso e próxima ocorrência calculada quando aplicável |
| Operação de envio | Comando e argumentos imutáveis, UUID persistente, estado e resultado remoto                                          |
| Metadados         | Versão do formato, conta vinculada, geração dos dados e horários de sincronização                                    |

Separar **conclusão registrada pelo usuário** de **comando enviado à API**. Isso permite preservar o evento original mesmo quando a integração encontrar um bloqueio.

### Interface em português brasileiro

- Grupos: **Atrasadas**, **Hoje**, **Próximas** e **Sem data**.
- Tela de detalhes com título completo, projeto, vencimento e botão **Concluir**.
- Área **Pendências** com conclusões ainda não confirmadas.
- Histórico local das ocorrências registradas offline.
- Botão **Sincronizar**.
- Indicadores: **Offline**, **Sincronizando**, **Pendências** e **Última sincronização**.

O prazo de sete dias é uma exigência de funcionamento offline, **não um filtro para baixar tarefas**. Tarefas com vencimento daqui a meses também serão sincronizadas.

## 3. Persistência, autenticação e sincronização

### Armazenamento no relógio

Usar arquivos em `@zos/fs` para tarefas e fila; reservar `LocalStorage` para preferências pequenas. O `LocalStorage` documentado mantém dados carregados em memória, o que desaconselha concentrar nele todo o conjunto de tarefas. [Referências](https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/), [gravação de arquivos](https://docs.zepp.com/docs/reference/device-app-api/newAPI/fs/writeFileSync/).

Estratégia:

- Tarefas em blocos, com manifesto de geração, contagem e checksum.
- Uma geração válida continua disponível enquanto a próxima é recebida.
- Ativar a nova geração somente após receber e validar todos os blocos.
- Fila persistente separada, com duas cópias alternadas e número de sequência.
- Gravar e verificar a conclusão antes de mostrar sucesso.
- Recuperar a última versão válida após interrupção.
- Nunca apagar pendências para abrir espaço.

Não presumir atomicidade ou durabilidade de filesystem equivalente a um computador. Reinício, encerramento abrupto e falha de gravação precisam de testes físicos.

**Sem limites arbitrários de tarefas.** Se o conjunto exceder a capacidade real, preservar o cache anterior e informar a falha; não apresentar uma sincronização truncada como completa. Desinstalação ou restauração do dispositivo não serão mecanismos de backup.

### Autenticação

- Token pessoal informado somente nas configurações do Zepp.
- Persistência no celular por Settings Storage.
- HTTPS e cabeçalho `Authorization: Bearer`.
- Token ausente do relógio, pacote, Git, fixtures e logs.
- Depois de salvo, mostrar apenas “Token configurado”, sem reproduzir o valor.
- Em erro de autenticação, preservar tarefas e fila até a correção.

O [Settings Storage](https://docs.zepp.com/docs/reference/app-settings-api/settings-storage/) oferece persistência, mas a documentação consultada não garante um cofre criptográfico. Não criar uma “criptografia” com chave embutida no aplicativo.

OAuth fica para distribuição futura. O [componente Auth do Zepp](https://docs.zepp.com/docs/reference/app-settings-api/ui/auth/) documenta PKCE, mas sua interoperabilidade com o Todoist precisará de teste próprio.

### Fluxo de sincronização

Para reduzir complexidade na v0.1:

- Leitura por `GET /api/v1/tasks`, com paginação completa.
- Escritas pelo endpoint `/api/v1/sync`, usando comandos com UUID persistente.
- Não implementar leitura incremental por `sync_token` inicialmente.

A API documenta paginação por cursor e deduplicação de comandos pelo UUID. [Referência Todoist](https://developer.todoist.com/api/v1/).

Sequência:

1. Confirmar a conta e a versão do protocolo.
2. Transferir as operações pendentes para o Side Service.
3. Consultar o estado remoto necessário para detectar conflitos.
4. Processar operações em ordem, respeitando dependências da mesma tarefa.
5. Persistir cada resultado antes de confirmá-lo ao relógio.
6. Buscar todas as páginas de tarefas ativas, sem filtro temporal.
7. Transferir o novo conjunto em blocos numerados.
8. Validar e ativar os dados no relógio, mantendo sobrepostas as pendências restantes.
9. Atualizar a última sincronização completa.

O protocolo interno terá mensagens para identificação, envio de operações, consulta de resultados, transferência de blocos e confirmação da geração instalada.

### Falhas e conflitos

| Situação                              | Comportamento                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Bluetooth desconecta                  | Manter dados e fila; retomar na próxima sessão                                         |
| Resposta de escrita se perde          | Preservar UUID e argumentos; nunca criar outra operação equivalente                    |
| Página de tarefas falha               | Não substituir o conjunto local por dados incompletos                                  |
| API limita chamadas                   | Respeitar espera indicada e aplicar novas tentativas espaçadas                         |
| Token inválido                        | Suspender chamadas autenticadas e solicitar correção no Zepp                           |
| Tarefa desaparece                     | Não concluir que houve sucesso; pode ter sido concluída, excluída ou ficar inacessível |
| Recorrência mudou remotamente         | Bloquear a cadeia afetada e mostrar conflito                                           |
| Conta diferente                       | Impedir envio das pendências da conta anterior                                         |
| Operações novas durante sincronização | Mantê-las em geração posterior da fila                                                 |

Uma consulta seguida de escrita não elimina alterações simultâneas feitas por outro cliente. Sem uma precondição atômica documentada, não prometer resolução perfeita dessa corrida.

### Recorrências: objetivo avançado e limitação documentada

O comportamento desejado para suporte **completo** a recorrências será:

> Após sete conclusões diárias offline, a conta do Todoist registra as sete ocorrências nos dias originais, mantém a regra e apresenta a próxima data correta.

A documentação distingue conclusão comum, que admite `date_completed`, de conclusão recorrente. **Não transportar esse parâmetro para outro comando supondo que será aceito.** O [SDK oficial](https://github.com/Doist/todoist-api-python/blob/main/todoist_api_python/api.py) também não oferece data retroativa no método de fechamento.

A primeira etapa de integração deverá verificar um caminho público suportado para esse resultado. Se não existir:

- Registrar o bloqueio com evidências.
- Continuar o núcleo offline e preservar os eventos localmente.
- Manter desabilitada a reprodução de múltiplas conclusões recorrentes no servidor.
- Não declarar **suporte completo à sincronização retroativa de recorrências** na v0.1.
- Permitir entregar o núcleo offline v0.1 como **versão preliminar com limitação conhecida**, distinguindo as operações que sincronizam corretamente daquelas que permanecem pendentes localmente.
- Apresentar ao usuário estado claro de pendência ou conflito, sem sugerir que uma ocorrência foi confirmada remotamente.
- Não substituir o histórico por comentários, tarefas duplicadas ou datas artificiais.

Quanto ao calendário offline, “todas as regras” permanece objetivo posterior, pois ultrapassa o acréscimo pequeno que você indicou. A primeira cobertura proposta é **recorrência diária simples**, com reconhecimento estrito da regra. As demais continuam armazenadas e consultáveis; não haverá cálculo aproximado silencioso.

Essa redução de cobertura é uma recomendação explícita de escopo, e não uma afirmação de que o requisito completo já está resolvido.

## 4. Estrutura, Git e responsabilidades no Codex

Estrutura proposta, a ser criada somente na implementação:

```
app.js
app.json
package.json
package-lock.json
AGENTS.md
README.md
.gitignore

page/
  tasks/
  detail/
  pending/
  history/
  i18n/

app-side/
  index.js
  todoist-client.js
  sync-coordinator.js
  operation-store.js

setting/
  index.js

shared/
  domain/
  recurrence/
  protocol/
  storage/
  adapters/

assets/
tests/
  unit/
  integration/
  fixtures/

PLAN.md  # já existente na raiz; preservar neste caminho

docs/
  TECHNICAL-VALIDATION.md
  SYNC.md
  DEVELOPMENT.md
  QA.md

.codex/
  agents/
    developer.toml
    qa.toml

.github/
  workflows/
    checks.yml
```

Usar JavaScript com módulos e JSDoc, domínio independente do Zepp e adaptadores para filesystem, Bluetooth, relógio e HTTP. Evitar framework de interface adicional. Esta árvore é uma referência: manter o README e o `.gitignore` existentes e ajustar a organização conforme exigências efetivas do SDK, documentando mudanças significativas.

O `AGENTS.md` deverá estabelecer:

- Escopo e critérios de aceitação.
- Comandos de teste e compilação.
- Proibição de credenciais em código e logs.
- Persistência antes da confirmação visual.
- UUID imutável nas novas tentativas.
- Proibição de reduzir o histórico ou alterar recorrências silenciosamente.
- Um único responsável por editar cada conjunto de arquivos por vez, evitando conflitos entre agentes.
- Obrigação de distinguir testes executados, simulados e pendentes em hardware.
- Fluxo Git: branch `feature/v0.1.0`, commits por marco, PR para `main` sem merge automático.

O Codex reconhece [instruções em AGENTS.md](https://developers.openai.com/codex/guides/agents-md/).

### Organização dos agentes

| Responsabilidade | Trabalho                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| Principal        | Arquitetura, contratos, coordenação, integração e decisões de liberação |
| Desenvolvedor    | Implementação e correções, como único escritor do aplicativo            |
| QA               | Revisão independente, execução de testes e relato de defeitos           |

No ambiente que produziu o plano, o Codex informou CLI `0.163.0` e `multi_agent` habilitado, mas **nenhum subagente foi efetivamente testado**. Isso não comprova a mesma capacidade no futuro ambiente Cloud.

Na execução, o agente principal deve **verificar a disponibilidade real** e delegar, quando possível, implementação a um agente desenvolvedor e revisão independente a um QA. As configurações `.codex/agents/*.toml` são opcionais e não substituem a delegação efetiva. Se não houver subagentes, realizar implementação e revisão em etapas separadas, indicando a limitação. Referência: [subagentes do Codex](https://developers.openai.com/codex/multi-agent/).

### Git e fluxo de entrega

O repositório remoto privado **já existe** e contém README, `.gitignore` (template Node) e este `PLAN.md`. A `main` deve permanecer estável, sem commits diretos da implementação.

1. Conferir a branch padrão e o estado inicial do repositório; **não executar `git init` nem reescrever o histórico**.
2. Partir da `main` e criar a branch **`feature/v0.1.0`**. Se o Codex Cloud já tiver criado automaticamente outra branch para a tarefa, preservar as alterações e informar como será feita a correspondência, sem forçar movimentações destrutivas.
3. Desenvolver somente na branch de trabalho, mantendo os arquivos existentes sempre que possível.
4. Criar **commits pequenos e descritivos**, preferencialmente com [Conventional Commits](https://www.conventionalcommits.org/), por marco verificável (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Executar os testes pertinentes e registrar eventuais falhas antes de cada commit.
5. Não versionar tokens, `.env`, caches, dependências instaladas, logs ou artefatos temporários. Complementar o `.gitignore` existente quando necessário.
6. Configurar, se viável, CI no GitHub para lint, testes e build, sempre com fixtures/mocks e sem credenciais reais.
7. Enviar a branch ao GitHub e **abrir Pull Request de `feature/v0.1.0` para `main`**, contendo descrição, evidências de QA, limitações e testes físicos pendentes.
8. **Não realizar merge ou alterar a visibilidade do repositório sem autorização explícita do usuário.** Se o ambiente não permitir commit, push ou criação de PR, relatar a limitação real e entregar os próximos passos exatos, sem declarar operações que não ocorreram.
9. Ao final, informar branch, commits e hashes efetivos, estado do Git e URL do PR, caso exista.

A revisão e aprovação do PR são humanas; mesmo um build aprovado no Cloud não equivale a aprovação em hardware.

## 5. Etapas e critérios de aceitação

| Etapa                  | Entrega                                               | Aceitação verificável                                                                     |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0. Viabilidade crítica | Relatório sobre histórico retroativo e calendário     | Investigar mecanismo público suportado; se não houver, registrar limitação sem impedir o núcleo v0.1 |
| 1. Aplicativo mínimo   | Estrutura, branch, manifesto e tela inicial           | Compilar no ambiente disponível; preparar instalação e registrar teste físico como pendente até ser realizado |
| 2. Consulta offline    | Listas e detalhes com fixtures                        | Exibir atrasadas, hoje, futuras distantes e sem data, sem conexão                         |
| 3. Persistência        | Cache e recuperação                                   | Dados sobrevivem a fechar, reabrir e reiniciar; geração incompleta não substitui a válida |
| 4. Conclusão offline   | Eventos e fila durável                                | Conclusões sobrevivem a reinício; toque duplicado não duplica a operação                  |
| 5. Comunicação         | Protocolo Device App ↔ Side Service                   | Transferência interrompida não perde dados nem confirma escrita inexistente               |
| 6. Todoist             | Token, leitura paginada e operações comuns            | Todas as páginas carregadas; novas tentativas não duplicam conclusões                     |
| 7. Recorrência diária  | Registro offline e integração condicionada à etapa 0 | Eventos locais íntegros; sincronização retroativa apenas se comprovada; pendências visíveis quando não suportada |
| 8. QA e pacote         | Revisão, testes, build e Pull Request                 | Sem defeitos críticos conhecidos no núcleo; evidências, limitações, commits e testes físicos pendentes registrados |

A implementação pode ocorrer predominantemente em uma única tarefa do Codex, executando esses marcos em sequência. **A conclusão automática dessa tarefa não equivale a validação no relógio ou na conta real.**

### Testes automatizados

Usar o executor de testes do Node e adaptadores simulados.

Cobertura obrigatória:

- Paginação com múltiplas páginas, duplicatas e falha intermediária.
- Data sem horário, horário flutuante e horário com fuso.
- Mudança de dia e registro do instante UTC.
- Escrita incompleta, arquivo corrompido e recuperação.
- Reinício antes e depois de cada confirmação.
- Servidor aplica operação, mas sua resposta se perde.
- Sucesso parcial entre várias operações.
- Alteração remota de tarefa com conclusão pendente.
- Relações entre tarefa pai e subtarefas.
- Sete conclusões diárias distintas.
- Recorrência não reconhecida, sem avanço incorreto.
- Ausência de token e títulos sensíveis nos logs.

Testar conjuntos sintéticos de 100, 1.000 e 5.000 tarefas para identificar gargalos. Esses números são cargas de teste, não limites do produto.

### QA físico

No Bip 6 e Zepp Android:

- Instalação e atualização mantendo o mesmo `appId`.
- Consulta e conclusão com celular desligado.
- Reabertura e reinício durante o uso offline.
- Interrupções do Bluetooth e da internet.
- Android suspendendo o Zepp.
- Conferência das datas no histórico da conta Todoist.
- Verificação de que a próxima ocorrência não avançou duas vezes.
- Desempenho e espaço com volume representativo da conta.

A liberação de **suporte completo a recorrências** permanece bloqueada se as datas originais no Todoist não forem preservadas. Isso não impede a entrega de uma **v0.1 preliminar** com esse recurso limitado e explicitamente sinalizado, desde que não haja perda silenciosa de eventos nem sincronização incorreta.

## 6. Execução no Codex Cloud e validação local

### Fluxo principal — Codex Cloud

O repositório privado já existe. A próxima tarefa será **implementar**, não refazer o planejamento:

1. Selecionar no Codex Cloud um ambiente vinculado ao repositório `todoist-zepp-os` e conferir a presença deste `PLAN.md` na raiz.
2. Verificar estado inicial de Git e trabalhar na branch `feature/v0.1.0`, observando particularidades de branch da tarefa Cloud.
3. Preparar Node 22 LTS, ou versão comprovadamente compatível, e fixar versões de Zeus/ZML no lockfile.
4. Criar os comandos `npm test`, `npm run lint` e `npm run build`.
5. Implementar as etapas em sequência, preferencialmente com desenvolvedor e QA como subagentes reais; executar testes e gerar o pacote.
6. Criar commits por marcos, enviar a branch, abrir PR para `main` quando possível e deixar **merge pendente de revisão humana**.
7. Documentar claramente que **instalação no Bip 6, autenticação com a conta pessoal e QA físico** não foram executados pela nuvem.

### Continuação local e instalação no relógio

Quando houver acesso ao PC, ao celular e ao relógio:

1. Clonar ou atualizar o repositório preservando a branch e seu histórico.
2. Instalar as dependências registradas no lockfile e repetir lint, testes e build.
3. Executar o fluxo oficial de preview/instalação e validar o aplicativo no Bip 6.
4. Configurar o token Todoist apenas pelas configurações apropriadas do Zepp, fora do repositório.
5. Registrar o resultado de testes físicos e eventuais correções em commits novos antes da aprovação do PR.

O fluxo oficial utiliza:

- `zeus dev` para o simulador.
- `zeus build` para o pacote `.zab`.
- `zeus login` e `zeus preview` para gerar o QR de instalação.
- Modo de desenvolvedor do Zepp para escanear e instalar no relógio.

O guia documenta a ativação do modo de desenvolvedor tocando sete vezes no ícone Zepp em **Perfil → Configurações → Sobre**; confirmar os nomes na versão Android instalada. [CLI](https://docs.zepp.com/docs/guides/tools/cli/), [instalação no relógio](https://docs.zepp.com/docs/guides/quick-start/preview/).

### Limites do ambiente e entrega final

O ambiente Cloud não precisa do token pessoal para executar testes simulados ou compilar e **não possui acesso presumido ao Bluetooth, ao Zepp autenticado ou ao relógio físico**.

Ao terminar a tarefa, entregar:

- Lista do que foi implementado e do que está parcial ou não implementado.
- Resultado **efetivo** de `npm test`, `npm run lint`, `npm run build` e, quando houver, CI; indicar o que não foi executado.
- Artefato `.zab` ou instruções exatas para gerá-lo, sem presumir que o QR Code foi produzido.
- Passo a passo de instalação no Bip 6 e configuração do Todoist.
- Relatório de QA (automatizado, simulado e físico pendente), incluindo riscos conhecidos de recorrência e sincronização.
- Branch real, lista de commits com hashes, estado do Git e link do Pull Request, se criado.

A documentação atual diferencia experiências Cloud atuais e legadas; seguir o [guia de ambientes](https://learn.chatgpt.com/docs/environments/cloud-environments) correspondente à interface disponível.

**Pronto para implementar:** usar o prompt one-shot de implementação com este `PLAN.md` como referência. Não reiniciar o planejamento ou o Git. Não declarar concluídos testes físicos não realizados ou recursos recorrentes não comprovados.
