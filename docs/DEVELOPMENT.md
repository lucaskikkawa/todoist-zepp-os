# Desenvolvimento, instalação e validação

## Pré-requisitos

- Node >=22.15.0 (Cloud: 24.19.0), npm e Git; dependências fixadas em `package-lock.json`.
- Amazfit Bip 6 com firmware compatível com API_LEVEL 4.2; tela 390 × 450. Fontes e variantes em [Device Basic Information](https://docs.zepp.com/docs/reference/related-resources/device-list/).
- Android com Zepp pareado e acesso ao Todoist; computador com acesso aos serviços Zepp para preview.
- A conta pessoal e o token são usados somente na validação física, fora do repositório.

```sh
git switch feature/v0.1.0
npm ci --ignore-scripts
npm run lint
npm test
npm run build
```

`npm run build` prepara `build/source` por lista explícita de arquivos de produção, usa o compilador oficial ZPM3.1.5 e copia somente o `.zab` para `dist/`. Testes, scripts, documentos, credenciais e node_modules não entram no pacote. O processo falha se não houver `.zab`, mesmo se o compilador sair sem status de erro. Os caminhos gerados estão ignorados no Git.

ZML0.0.43 encapsula Bluetooth. Zeus1.9.3 fornece preview/desenvolvimento. `scripts/zeus.cjs` apenas resolve o alias `zeppos-app-utils` que o próprio pacote distribui; isso corrige a inicialização do CLI quando instalado localmente. Nenhum código do compilador foi modificado. O build padrão usa ZPM3.1.5 porque essa versão oficial consegue compilar com metadados de dispositivos já incluídos, sem consulta remota obrigatória. A API do aplicativo permanece 4.2. A compatibilidade final é validada instalando no firmware real.

Caminhos opcionais com o Zeus atual:

```sh
npm run build:zeus
npm run dev -- --target "Amazfit Bip 6"
npm run zeus -- login
npm run preview -- --target "Amazfit Bip 6"
```

`build:zeus` também usa a árvore de produção isolada. No Cloud a consulta a `https://upload-cdn.zepp.com/zeppos/devkit/zeus/v1/devices.json` recebeu HTTP403 `Domain forbidden`. O build padrão ZPM foi executado com sucesso; não foram forjados metadados de catálogo ou burlada a política de rede. Não há necessidade de liberar esse domínio para repetir `npm run build`. Login/preview continuam exigindo conexão ao Zepp e conta do desenvolvedor. Se o Zeus solicitar a escolha do dispositivo, selecione **Amazfit Bip 6**.

## Instalação no Bip 6

1. Compile como acima. Conserve `dist/Pulso-0.1.0-*.zab` e, opcionalmente, confira seu SHA256.
2. No Android, ative o modo de desenvolvedor do Zepp. O [guia oficial](https://docs.zepp.com/docs/guides/quick-start/preview/) orienta tocar sete vezes no ícone Zepp em Perfil → Configurações → Sobre; nomes podem variar conforme a versão.
3. No computador, execute `npm run zeus -- login` e autentique-se no fluxo do próprio Zeus. Não envie sua senha ou credenciais para o Codex.
4. Execute `npm run preview -- --target "Amazfit Bip 6"`. Escaneie o QR gerado pelo Zeus no leitor de desenvolvedor do Zepp e confirme o envio para o relógio pareado. O preview recompila as mesmas fontes; o `.zab` não vira um QR instalável apenas abrindo o arquivo ou criando um QR com um caminho local.
5. Se o QR expirar, gere outro preview. A metadata do compilador inclui `packageInfo.expiredTime=172800`; a validade efetiva do fluxo depende do Zepp. Não foi testada expiração de instalação ou permanência por sete dias no relógio.
6. Abra **Pulso** na lista de aplicativos do relógio.

O `appId` provisório está fixado em **1052671** para manter o mesmo namespace em atualizações. Não houve registro no portal de desenvolvedor nem comprovação de titularidade desse ID. Se seu fluxo de preview/distribuição exigir ID atribuído, use um ID próprio do portal **antes da primeira instalação** e faça commit da configuração; em atualizações futuras mantenha o mesmo ID e incremente `version.code`. Não desinstale como procedimento de atualização sem antes preservar dados pendentes.

Para simulador, instale o simulador Zepp separadamente e use `npm run dev`. As fontes são copiadas para uma árvore isolada no início: reinicie o comando após editar o código do projeto. Nenhum simulador gráfico foi executado no Cloud. [Guia da CLI](https://docs.zepp.com/docs/guides/tools/cli/).

## Configuração Todoist

1. No Todoist, abra as configurações de integrações/desenvolvedor da sua conta e localize o token pessoal conforme a interface atual do serviço. Não crie um arquivo `.env` com esse valor.
2. No Zepp, abra a página de configurações do **Pulso**. Cole o token no campo dedicado e toque em **Salvar token**.
3. Depois de salvo, o campo é limpo e a página mostra **Token configurado**, sem recuperar o valor salvo para exibição. Um rascunho fica apenas em memória até salvar.
4. Abra o Pulso no relógio e toque em **Sincronizar** com Zepp disponível, Bluetooth e internet ativos. Aguarde **Sincronização completa**. A primeira leitura inclui todos os projetos e tarefas ativas, sem filtro temporal.
5. Desligue o celular e consulte grupos e detalhes. Uma conclusão é confirmada visualmente somente depois da gravação e releitura dos dois espelhos da fila.
6. Para token inválido, substitua-o nas configurações do Zepp. Remover o token não apaga tarefas ou fila do relógio. A ausência de token não impede consulta local.

O token permanece no Settings Storage do celular e no cabeçalho HTTPS. Nunca é transferido ao relógio. Settings Storage é uma API persistente, não uma garantia de cofre criptográfico. O TextInput nativo não documenta modo senha: proteja a tela ao colar o token. O aplicativo não faz logs de tarefas, tokens ou respostas HTTP.

## Pendências e recorrências

No relógio, **Pendências** lista o que ainda não foi confirmado, e **Histórico local** conserva os eventos e horários originais, inclusive os já confirmados. Após sincronizar, as configurações do Zepp mostram conflitos/recorrências para revisão. **Revisar e resolver → Confirmar resolução local** preserva o evento no histórico, não envia conclusão remota, e permite usar o estado atual do servidor na próxima sincronização. Isso não registra retrospectivamente a ocorrência no Todoist.

Toda recorrência tem envio remoto bloqueado. Somente data sem horário e regras literais `every day`, `daily`, `todos os dias`, `todo dia` ou `diariamente` recebem avanço local. Regras relativas `!`, intervalos, dias úteis, horários e outras expressões continuam armazenadas; não recebem datas aproximadas. Cada tarefa recorrente aceita no máximo um registro por dia local para evitar toque duplicado. Avanço é uma ocorrência do calendário por conclusão, sem reconstrução de ocorrências perdidas e sem alterações na regra do servidor.

## Recuperação e limitações operacionais

- Falhas de rede/Bluetooth: reabra o aplicativo e sincronize novamente. UUID e argumentos não mudam.
- Falha em uma página/bloco/espaço: o conjunto anterior permanece ativo; não há substituição por lista parcial. Blocos abandonados são limpos na próxima transferência.
- Uma cópia de fila danificada: recuperar a outra cópia verificada. Duas cópias inválidas: consulta do cache em modo somente leitura, sem sincronizar/concluir; não apague os arquivos. O cache bruto pode mostrar tarefas já concluídas quando a fila está indisponível.
- Duas gerações de tarefas danificadas: sem cache consultável; fila continua preservada. Reconecte para recuperar os dados do servidor apenas quando o diário puder ser lido com segurança.
- Conta diferente: bloquear envio e substituição de dados. v0.1 não oferece migração/troca de conta. Corrija o token para a conta original; não limpe os dados para contornar o bloqueio.
- Sem backup/exportação na interface v0.1; restauração de fábrica/desinstalação apagam armazenamento. Preserve dados pendentes antes dessas ações.
- Histórico/fila crescem sem descarte automático. Capacidade real, memória, duração de sincronização com muitas conclusões e comportamento do filesystem precisam de medição física. Em falta de espaço, manter dados e indicar erro.

Checklist e evidências estão em [QA.md](QA.md). Atualize esse relatório com firmware, Zepp, datas, volume, falhas e resultados reais antes de aprovar o merge na `main`.
