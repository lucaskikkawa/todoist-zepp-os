# Validação técnica — Pulso 0.1.0

Verificação documental independente em 20/10/2026. Compilação e simulações no Cloud não demonstram execução física no relógio.

## Plataforma e contratos oficiais

- A [tabela oficial de dispositivos](https://docs.zepp.com/docs/reference/related-resources/device-list/) lista o Amazfit Bip 6 com Zepp OS 5.0, API_LEVEL 4.2, tela quadrada de 390 × 450 pixels, raio 86 e `deviceSource` 9765120 (China), 9765121 e 10158337. O firmware instalado deve ser conferido na validação física.
- A [configuração de aplicativos](https://docs.zepp.com/docs/reference/app-json/) documenta `configVersion: "v3"`, `app.version`, módulos Device/Side/Settings, plataformas por `deviceSource` e `designWidth`. A chave do alvo corresponde ao diretório de assets.
- A permissão `data:os.device.info` corresponde à consulta de informações usada pela camada de compatibilidade ZML ([getDeviceInfo](https://docs.zepp.com/docs/reference/device-app-api/newAPI/device/getDeviceInfo/)); não autoriza acesso ao token nem a dados de saúde.
- A [compatibilidade de API_LEVEL](https://docs.zepp.com/docs/guides/framework/device/compatibility/) é definida pelo `runtime.apiVersion.minVersion`; a versão do CLI é independente.
- O manifesto declara `data:os.device.info`, permissão documentada para [getDeviceInfo](https://docs.zepp.com/docs/reference/device-app-api/newAPI/device/getDeviceInfo/), exposta pelo runtime e referenciada pela camada de compatibilidade ZML. Não há acesso a tarefas/credenciais por essa permissão.
- O [ZML oficial](https://zepp-health.github.io/zml/getting-started) usa `BaseApp`, `BasePage` e `BaseSideService`. Seu [protocolo request](https://zepp-health.github.io/zml/api) oferece `request({method, params})` e `onRequest(req, res)`, com resposta no formato `res(null, dados)`. A página de [limitações](https://zepp-health.github.io/zml/known-issues) indica requisito mais recente API_LEVEL 3.6, atendido pelo alvo 4.2.
- [readFileSync](https://docs.zepp.com/docs/reference/device-app-api/newAPI/fs/readFileSync/) e [writeFileSync](https://docs.zepp.com/docs/reference/device-app-api/newAPI/fs/writeFileSync/) estão documentados desde API_LEVEL 2.0. Operam no diretório `/data` do aplicativo e aceitam a opção `encoding: 'utf8'`. Uma leitura pode retornar `undefined`. Não há nessa documentação garantia de atomicidade ou durabilidade após perda de energia.

## Toolchain executado

`npm run build` usa o compilador oficial `@zeppos/zpm` 3.1.5 fixado no lockfile, com Rollup, QJSC e conversão de imagem reais. O pacote foi inspecionado recursivamente: loader binário, API_LEVEL 4.2, três variantes Bip 6, cinco binários do relógio e os módulos de telefone esperados. O Zeus CLI 1.9.3 também está instalado; sua consulta obrigatória de catálogo foi bloqueada pela rede do Cloud. O caminho local do compilador oficial permite gerar o pacote sem modificar ferramentas ou política de rede. Resultados e hash da execução independente estão em [QA.md](QA.md).

A compilação mantém metadados de pacote gerados pelo fornecedor, incluindo `expiredTime: 172800`. A documentação pública consultada descreve expiração do QR de preview; não foi comprovado que esse campo limita a execução offline do aplicativo instalado. A verificação física deve incluir abertura depois de 48 horas e sete dias, sem supor expiração ou permanência com base apenas nesse campo.

## Evidência e limites

O software deve carregar dados locais antes de qualquer tentativa de sincronização, usar armazenamento verificado antes de confirmar uma conclusão e manter operações imutáveis entre tentativas. Os testes automatizados exercitam esses contratos com adaptadores simulados; a capacidade de flash, memória, o tempo de transferência Bluetooth e o ciclo de vida do Zepp Android precisam ser medidos no Bip 6.

A referência da API Todoist e a decisão sobre recorrências estão em [TODOIST-API.md](TODOIST-API.md), quando presente. A ausência de parâmetro documentado para concluir recorrências em horários históricos impede declarar suporte retroativo completo. Eventos locais devem permanecer visíveis e o envio recorrente deve continuar bloqueado.

## Validação física obrigatória

1. Confirmar firmware/API_LEVEL e instalar por `zeus preview` usando conta de desenvolvedor Zepp.
2. Conferir layout 390 × 450, legibilidade, toque, rolagem e botão físico de retorno.
3. Sincronizar uma conta de teste e conferir tarefas futuras distantes e sem data.
4. Desligar o telefone, consultar tarefas e concluir; fechar/reabrir e reiniciar o relógio. Repetir após 48 horas e sete dias para conferir permanência dos dados e execução offline.
5. Interromper Bluetooth durante blocos e durante a confirmação de uma escrita; reconectar e verificar ausência de duplicação.
6. Simular rede indisponível e Zepp suspenso pelo Android, mantendo consulta offline.
7. Comparar horário UTC/local das conclusões comuns com o histórico Todoist e conferir pendências recorrentes preservadas.
8. Medir memória, espaço e latência com volume representativo; verificar atualização mantendo o mesmo appId.

Nenhuma dessas etapas pode ser marcada como executada somente pela compilação do pacote.
