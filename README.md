# Pulso — Todoist para Zepp OS

Cliente pessoal offline do Todoist para Amazfit Bip 6, **v0.1.0 preliminar**. Inclui Device App, Side Service e Settings App, em português brasileiro. Planejamento preservado em [PLAN.md](PLAN.md).

- Baixa todas as páginas de tarefas ativas: atrasadas, hoje, futuras distantes e sem data.
- Guarda tarefas em arquivos no relógio; a consulta não depende do celular após a primeira sincronização.
- Registra conclusões offline com instante UTC, dia/fuso local, histórico e fila persistente espelhada.
- Envia conclusões comuns com UUID imutável e `date_completed`; verifica conta, mudanças remotas e subtarefas antes do primeiro envio.
- Preserva cache anterior em transferências incompletas, oferece recuperação e modo somente consulta quando a fila está danificada.
- Permite revisar conflitos nas configurações do Zepp sem apagar o histórico nem inventar outra operação remota.

**Recorrências:** todos os eventos ficam no relógio. Somente regras diárias simples, sem horário, reconhecidas estritamente, avançam a data local. **Nenhuma conclusão recorrente é enviada ao Todoist nesta versão.** O mecanismo público verificado não comprova preservar os horários históricos no comando recorrente. Veja [evidências da API](docs/TODOIST-API.md).

## Desenvolvimento e pacote

Node **22.15 ou superior**; Node 24.19 foi usado no Cloud.

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm run build
```

O pacote real fica em `dist/Pulso-0.1.0-*.zab`. O build padrão usa o compilador oficial `@zeppos/zpm@3.1.5`, com Rollup, conversão de imagens e QuickJS bytecode, sem consulta obrigatória ao catálogo remoto. Zeus CLI `1.9.3` e ZML `0.0.43` também estão fixados no lockfile. `npm run build:zeus` usa o Zeus mais recente instalado e requer acesso a `upload-cdn.zepp.com`; esse caminho foi bloqueado pela política de rede do Cloud (403). O compilador e os dados do catálogo não foram alterados.

Os testes são executados no Node com adaptadores simulados, incluindo a integração local dos três apps. **Não representam validação no relógio nem chamadas à conta real.** [QA independente](docs/QA.md) e [validação técnica](docs/TECHNICAL-VALIDATION.md).

## Instalar e configurar

Consulte o [guia completo de instalação e desenvolvimento](docs/DEVELOPMENT.md). Fluxo resumido:

1. Ative o modo desenvolvedor do Zepp Android (Perfil → Configurações → Sobre; toque sete vezes no ícone Zepp, conforme a versão instalada).
2. No computador: `npm run zeus -- login`, depois `npm run preview -- --target "Amazfit Bip 6"`. O Zeus exige login pessoal e acesso aos serviços Zepp para gerar o QR; não houve login na nuvem.
3. Escaneie o QR no fluxo de desenvolvedor do Zepp para instalar no Bip 6. Preserve `appId: 1052671` nas atualizações; se o portal Zepp exigir um appId atribuído, faça essa configuração **antes da primeira instalação**, preservando depois esse ID.
4. Abra as configurações do Pulso no Zepp, cole o token pessoal Todoist e toque em **Salvar token**. Nunca coloque o token em código, terminal ou conversa.
5. No relógio, toque em **Sincronizar** e aguarde a indicação de sincronização completa antes de desligar o celular.

O `.zab` é um pacote real compilado; instalação, fluidez da interface, integração autenticada, Bluetooth e persistência após reinício físico ainda precisam da validação no seu Bip 6. Não foi gerado QR nesta sessão.

## Limitações

Sincronização manual ao abrir o Pulso; não há garantia de execução em segundo plano. Não há troca de conta ou edição completa de tarefas. Pais com subtarefas ativas ficam bloqueados até a conclusão dos filhos. A consulta e a escrita remota não têm precondição atômica; alterações simultâneas de outros clientes continuam sendo um risco documentado. A capacidade real de armazenamento/memória e a autonomia por sete dias precisam de teste físico. Não desinstale para resolver erros: a desinstalação remove os dados locais.

[Arquitetura e protocolo](docs/SYNC.md) · [Critérios e testes físicos](docs/QA.md)
