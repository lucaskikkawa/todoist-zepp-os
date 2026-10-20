# API Todoist — evidências e limitações da v0.1.0

Consulta realizada em 20/10/2026 na [referência oficial Todoist API v1](https://developer.todoist.com/api/v1/) e no [SDK oficial Python](https://github.com/Doist/todoist-api-python/blob/07aba94293fbbfa40470e0bdd89c00d1f943b847/todoist_api_python/api.py). Nenhuma chamada à conta real foi realizada; os testes usam dados simulados.

## Leitura e identidade

- `GET https://api.todoist.com/api/v1/user`: identidade autenticada; a referência atual o descreve como endpoint OIDC userinfo. O adaptador aceita o identificador `sub` e o formato `id`; nenhum e-mail é necessário para vincular a conta.
- `GET /api/v1/tasks?limit=200`, passando o cursor opaco de `next_cursor` até seu valor ser `null`. Não usar `filter`, datas, projetos ou outro recorte que exclua tarefas. IDs duplicados entre páginas são deduplicados; cursor repetido ou página inválida interrompe a geração.
- `GET /api/v1/projects` é igualmente paginado e fornece nomes dos projetos.
- `GET /api/v1/tasks/{id}` devolve apenas tarefa ativa. Um `404` não prova que uma conclusão pendente foi aplicada: também pode significar exclusão ou perda de acesso.

Falhar em qualquer página rejeita o conjunto inteiro. A paginação REST não fornece uma fotografia transacional: alterações durante a leitura podem causar omissões, conforme a própria documentação. A v0.1 deduplica IDs e faz nova leitura completa na próxima sincronização; não promete isolamento transacional.

## Conclusão comum

O endpoint `POST /api/v1/sync` usa corpo `application/x-www-form-urlencoded`; o campo `commands` contém JSON. O comando `item_complete` aceita `id` e `date_completed`, data RFC3339 em UTC. Isso permite transmitir o instante originalmente registrado no relógio. A referência documenta deduplicação por UUID de comando e apresenta `sync_status[uuid] = "ok"` para sucesso.

O payload e o UUID são criados no relógio e permanecem imutáveis. O Side Service grava o estado de envio antes da chamada e grava o resultado antes de confirmá-lo ao relógio. Se a resposta se perder, reenvia o mesmo comando/UUID, mesmo que a tarefa não apareça mais em consultas de tarefas ativas. Não substitui UUID nem considera um `404` isolado como confirmação.

**Importante:** `item_complete` também conclui subtarefas. A v0.1 bloqueia o envio de pais com filhos ainda ativos; conclua os filhos primeiro. Revisão, título, prioridade, projeto, pai e vencimento são comparados com o registro sincronizado antes do primeiro envio. Não há precondição atômica documentada que elimine a corrida entre essa consulta e uma alteração simultânea por outro cliente.

## Recorrências: registro local, reprodução remota desabilitada

O comando documentado para uma conclusão recorrente é `item_update_date_complete`. Seus argumentos documentados são `id`, `due`, `is_forward` e `reset_subtasks`. A referência não documenta `date_completed` para esse comando. Já `item_close` simplifica o fechamento e o reagendamento, mas também não fornece o instante histórico original. O método `complete_task(task_id)` do SDK oficial Python não recebe horário retroativo.

Portanto, não há evidência pública verificada suficiente para prometer sete conclusões recorrentes retroativas com seus sete instantes originais. Não extrapolamos o parâmetro do comando comum para o comando recorrente. A v0.1 **não envia nenhum comando para reproduzir conclusões recorrentes**: conserva cada evento local, horário UTC e data/fuso, com pendência explícita `RECURRING_HISTORY_UNSUPPORTED`. Reconhecer uma regra diária para consulta offline não remove essa restrição.

Resolver explicitamente uma pendência usando o estado atual do Todoist arquiva apenas a pendência local, preserva o histórico e não executa novo comando no servidor. Essa decisão não confirma remotamente as ocorrências locais.

## Falhas e credenciais

O token entra somente pelo Settings Storage do Zepp e segue no cabeçalho HTTPS `Authorization`. Uma sessão captura a credencial para evitar trocar de conta no meio da operação. A conta é verificada antes dos envios e da leitura. Falhas de rede, `429`, `5xx` e respostas ambíguas preservam a operação. `Retry-After`, numérico ou data HTTP, determina a próxima oportunidade de envio; não há espera bloqueante nem repetição acelerada automática. `401`/`403` interrompem o lote e pedem correção da configuração.

Erros públicos contêm apenas códigos estáveis; respostas brutas, cabeçalhos, tokens e títulos não são copiados para logs nem mensagens de erro. Settings Storage é persistência documentada, não uma promessa de cofre criptográfico.

## Evidência executada

Os testes em `tests/integration/side-service.test.js` exercitam o cliente HTTP, o diário persistente e o coordenador com servidor/armazenamento simulados: paginação, 100/1.000/5.000 tarefas, erros intermediários, respostas perdidas, reinício, sucesso parcial, deduplicação, conflitos, subtarefas, conta diferente, recorrências bloqueadas, `Retry-After` e persistência antes do envio/ACK. São testes de integração entre módulos locais com transporte simulado; não são integração real Todoist/Zepp/Bluetooth.
