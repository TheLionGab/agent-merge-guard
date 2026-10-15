# agent-workflow-gates

Portões de decisão para fluxos com vários agentes de IA, escritos como
**funções puras**: sem rede, sem modelo, testáveis uma a uma.

English: pure, dependency-free decision gates for multi-agent workflows.
The agent reads facts; a deterministic script decides. Node 22, no
dependencies, 18 tests.

## A ideia

Prompt não é limite. Se "não mescle sem revisão" só existe no texto do
prompt, um agente confuso ou um texto hostil pode contornar. Aqui o limite
está no código:

1. O agente **só lê** e devolve fatos literais (estado do PR, SHA, lista
   de arquivos, resultado do CI).
2. Uma função pura (`decidirMerge`) decide, com o merge desligado por
   padrão.
3. O merge sai com `--match-head-commit <sha inspecionado>`: se o PR mudou
   no meio, o `gh` recusa.
4. Depois do merge, o **estado do PR** decide, não o texto que o agente
   respondeu (`confirmarMerge`).

## O que está aqui

- `src/merge-gate.mjs`
  - `decidirMerge(inspecao, { branchEsperada, allowlist, merge })`
  - `caminhoOk`: allowlist de caminhos; renomeação conta pelos dois lados
    e `..` reprova
  - `comandoMerge`: monta o comando só com PR inteiro, SHA de 40 hex e
    `owner/repo` válidos
  - `confirmarMerge`: alerta se o PR foi mesclado com head diferente do
    inspecionado
- `src/untrusted.mjs`
  - `dado(rotulo, valor)`: embrulha texto de fora do fluxo (logs, posts de
    usuário, saída de outro modelo) num bloco marcado como dado, nunca
    como instrução. O valor não consegue fechar nem reabrir o bloco, em
    qualquer caixa ou espaçamento.
- `test/`: 18 testes (`npm test`, Node 22, sem dependências).

Condições para `mesclar: true`, todas ao mesmo tempo: `merge === true`
explícito, PR da branch esperada, aberto, base `main`, fora de draft, SHA
lido antes e depois idêntico e válido, lista de arquivos completa (a
paginação bate com `changedFiles`), todo arquivo dentro da allowlist e CI
`success`.

## De onde vem

Extraído de um workflow multiagente real (descobrir, um cético por achado,
priorizar, registrar, implementar com crítico cego e PR para humano) que uso
num app em produção. Aquele repositório é privado e o fluxo é específico do
produto; aqui está só o núcleo reutilizável. O histórico dele mostra o que
cada rodada de revisão de segurança achou:

- texto de produção entrava cru em prompt de agente com permissão de Bash e
  de merge, e agentes mesclavam por conta própria;
- a lista de arquivos do PR não mostrava o lado antigo de uma renomeação;
- um push entre a leitura do CI, a do SHA e a da lista de arquivos fazia o
  portão mesclar um head que ninguém inspecionou.

Cada achado virou uma regra acima e um teste. Os testes foram validados por
mutação: tirar o lado antigo da renomeação, a igualdade de SHA, o opt-in do
merge ou a neutralização do bloco de dado faz pelo menos um teste falhar.

Mudança feita ao extrair: `dado()` aqui neutraliza o fecho do bloco. O
helper original não fazia isso.

## Limites

- Não executa agentes nem chama o GitHub: decide a partir da inspeção que
  você fornece. Quem coleta os fatos precisa ser fiel ao formato.
- Allowlist é por regex de caminho; escrever uma boa é responsabilidade sua.
- A marcação de dado reduz injeção de prompt, não a elimina.

## Licença

MIT.
