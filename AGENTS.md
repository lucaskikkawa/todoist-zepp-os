# Pulso v0.1.0

Leia PLAN.md integralmente; notas iniciais prevalecem. Trabalhe em feature/v0.1.0; main recebe somente PR com aprovação humana. Preserve histórico. Faça commits por marco após testes pertinentes. Nunca merge automaticamente.

- Núcleo: todas as tarefas ativas offline, persistência, conclusões e fila duráveis.
- Nunca versionar/exibir tokens, dados de conta reais ou títulos em logs. Token somente Settings Storage do Zepp, nunca no relógio.
- Persistir e reler uma conclusão antes de confirmar sucesso visual. UUID e argumentos são imutáveis nas tentativas.
- Não remover pendências para liberar espaço. Cache incompleto nunca substitui geração válida.
- Preservar eventos recorrentes e instante original; não reproduzir recorrências no servidor sem suporte documentado comprovado.
- Um escritor por conjunto de arquivos; comunicar contratos e bugs entre agentes. QA independente somente testes/relatórios.
- Comandos: npm ci, npm test, npm run lint, npm run build. Node >=22; toolchain fixado em package-lock.json.
- Distinguir testes com adaptadores simulados, compilação oficial, integração real e validação física pendente.
