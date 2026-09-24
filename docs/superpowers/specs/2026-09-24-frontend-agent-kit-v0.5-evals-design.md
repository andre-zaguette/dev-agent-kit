# Frontend Agent Kit v0.5 — Eval Suite + Benchmark Claude vs Codex

**Data:** 2026-09-24
**Status:** aprovado (brainstorming 2026-09-24)
**Base:** spec principal `2026-09-23-frontend-agent-kit-design.md` §8 (Evals) e §10 (v0.5)

## 1. Objetivo

Medir, de forma reprodutível, se as skills + MCPs do kit fazem um agente seguir o
workflow prescrito (Figma como fonte de verdade → inspeção → reuso → implementação
→ validação) e comparar Claude Code e Codex nos mesmos cenários.

Decisões do brainstorming:

| Tema | Decisão |
|------|---------|
| Benchmark | **Real, opt-in.** `npm test` é offline e custo zero; `npm run bench` roda os hosts de verdade. |
| Grader | **Determinístico.** Sem LLM judge. |
| Fonte do design | **MCP Figma mock** com o mesmo nome de servidor (`figma`) e tools das skills. |

## 2. Layout

```
packages/evals/                 ← @frontend-agent-kit/evals (0.5.0)
  src/
    schema.ts                   ← zod: Scenario, Assertion, FigmaFixture
    load.ts                     ← carrega/valida cenários + referências a fixtures
    grade.ts                    ← aplica expected/forbidden a um RunRecord
    transcript/claude.ts        ← stream-json → RunRecord
    transcript/codex.ts         ← exec --json → RunRecord
    figma-mock/server.ts        ← MCP stdio com dados gravados
    workspace.ts                ← copia fixture para dir temporário (sem seguir symlinks)
    static-server.ts            ← serve o fixture em 127.0.0.1:<porta livre>
    hosts.ts                    ← monta o comando headless por host
    bench.ts                    ← orquestra cenário × host
    report.ts                   ← summary.json + report.md
  bin/bench.mjs
  tests/
evals/
  scenarios/*.json              ← 18 cenários
  fixtures/<nome>/              ← apps mínimos
  figma/<nome>.json             ← respostas do mock
  results/                      ← saída do bench (gitignored)
```

## 3. Cenários (18)

- **base (7):** tela simples; com componentes existentes (deve reutilizar);
  mobile; motion; Figma grande (deve usar `get_metadata` antes de
  `get_design_context` por nó); Figma com asset (deve usar o asset do Figma, não
  placeholder); divergência visual proposital (deve reportar, não esconder).
  Fixture: app HTML/CSS/JS vanilla servido em localhost.
- **stack (8):** react, nextjs, vuejs, nuxt, angular, tailwind, php, html-css-js.
  Fixtures esqueleto (manifesto + 1–2 componentes, sem `npm install`). Testam
  detecção de stack, uso de `references/<stack>.md` e convenções (ex.: SFC em Vue,
  classes utilitárias em Tailwind). Sem validação visual.
- **profile (3):** pixel-perfect, standard, relaxed — mesmo fixture vanilla com
  `.frontend-agent/config.yml` diferente; checam que o agente respeita o perfil
  (ex.: pixel-perfect não aprova só por similaridade de pixel).

## 4. Formato do cenário

```json
{
  "id": "base-simple-screen",
  "category": "base",
  "title": "Tela simples a partir do Figma",
  "fixture": "vanilla-app",
  "figma": "simple-screen",
  "profile": "standard",
  "prompt": "Implemente o frame 'Pricing' do Figma em pages/pricing.html ...",
  "timeoutSec": 900,
  "expected": [
    { "type": "tool_called", "tool": "figma/get_design_context" },
    { "type": "tool_called", "tool": "frontend-agent/compare_screenshots" },
    { "type": "file_exists", "path": "pages/pricing.html" }
  ],
  "forbidden": [
    { "type": "file_matches", "glob": "pages/**/*.html", "pattern": "placeholder\\.com" },
    { "type": "tool_called", "tool": "frontend-agent/capture_screenshot",
      "args": { "url": "^(?!http://(127\\.0\\.0\\.1|localhost))" } }
  ]
}
```

Tipos de asserção:

| Tipo | Campos | Satisfeita quando |
|------|--------|-------------------|
| `tool_called` | `tool` (`servidor/tool`), `args?` (campo → regex) | alguma chamada no transcript bate |
| `output_matches` | `pattern`, `flags?` | regex bate na resposta final do agente |
| `file_matches` | `glob`, `pattern` | algum arquivo do workspace (pós-execução) bate |
| `file_exists` | `path` | arquivo existe no workspace |

- `expected`: todas precisam ser satisfeitas. `forbidden`: nenhuma pode ser.
- Resultado do cenário: `pass` | `fail` | `error` (host falhou, timeout, transcript
  ilegível). `error` nunca conta como `pass`.
- Nomes de tool são normalizados para `servidor/tool` (Claude: `mcp__srv__tool`;
  Codex: evento de tool call MCP com server + tool). Skills lidas também viram
  eventos (`skill/<nome>`) quando o host as expõe.
- Paths e globs são relativos ao workspace; `..` e absolutos são rejeitados pelo
  schema. O grader nunca executa código do fixture.

## 5. Figma mock

MCP stdio (`@modelcontextprotocol/sdk`) registrado com o nome `figma`, tools
`get_design_context`, `get_variable_defs`, `get_screenshot`, `get_metadata`,
schemas compatíveis com o Figma MCP oficial nos campos usados pelas skills
(`nodeId`, opcionais tolerados). Lê `evals/figma/<nome>.json` via variável de
ambiente `FIGMA_MOCK_FIXTURE`. Nó desconhecido → erro MCP explícito (o agente
precisa lidar como faria com o real). Screenshot devolvido como imagem PNG do
fixture.

## 6. Benchmark

`npm run bench -- [--host claude|codex|all] [--scenario <id>...] [--category <c>]`

Por cenário × host:

1. Copia `evals/fixtures/<fixture>` para `os.tmpdir()/fak-bench-<rand>/`
   (recusa symlinks; tamanho máximo configurável).
2. Roda o install da CLI em processo (`includeFigma: false`) para o host.
3. Sobe o servidor estático em `127.0.0.1:<porta livre>` e grava
   `.frontend-agent/config.yml` com a allowlist dessa origem e o perfil do cenário.
4. Executa o host headless, cwd = workspace, com timeout e kill da árvore de
   processos:
   - **Claude:** `claude -p <prompt> --output-format stream-json --verbose
     --mcp-config <gerado> --strict-mcp-config --setting-sources project
     --allowedTools <lista do kit + Read/Edit/Write/Glob/Grep>`.
   - **Codex:** `codex exec --json --sandbox workspace-write --skip-git-repo-check
     --ephemeral -C <workspace> -c mcp_servers.figma=… -c mcp_servers.frontend-agent=…`
     (MCP por `-c` para não depender de trust). Isolamento da config do usuário
     (`--ignore-user-config`) e comportamento de auth: a confirmar no plano.
5. Parse do transcript → `RunRecord { toolCalls[], finalText, durationMs,
   usage?, exitCode, error? }` → grade.
6. Grava em `evals/results/<timestamp>/`: `transcripts/<host>/<id>.jsonl`,
   `summary.json`, `report.md` (pass rate por host e categoria, tabela
   cenário × host, falhas com a asserção que falhou, duração, tokens/custo quando
   o host reporta).

Execução sequencial por padrão (`--concurrency` opcional). O workspace temporário
é removido ao final, a menos que `--keep`.

## 7. Testes offline (`npm test`)

- Todos os cenários passam no schema e referenciam fixture/figma existentes;
  contagem mínima por categoria (7/8/3).
- Parsers testados com transcripts de exemplo gravados (`tests/data/`).
- Grader: cada tipo de asserção em expected e forbidden, `error` nunca `pass`.
- Figma mock via cliente MCP (listTools, nó conhecido, nó desconhecido).
- Bench ponta a ponta com um host fake (script Node que emite um transcript
  `stream-json` fixo e edita um arquivo) — zero tokens.
- workspace: symlink no fixture é recusado; path traversal em asserção é rejeitado.

## 8. Pendências v0.4.1 incluídas

- `preflight` roda as checagens de merge TOML e de manifesto antes de qualquer
  escrita (erro não deixa instalação parcial).
- `verify` compara o conteúdo instalado com o do kit (hash) e reporta
  divergência/desatualização.
- Symlink AGENTS.md → CLAUDE.md pendurado: tratado com mensagem acionável em vez
  de recusa genérica.

Fora: paths Windows (v1.0).

## 9. Ataques e casos de borda

- Agente headless sem supervisão: cwd confinado ao workspace temporário, allowlist
  de tools (Claude) / sandbox `workspace-write` (Codex), sem `bypassPermissions`,
  timeout com kill do grupo de processos.
- MCPs globais do usuário não vazam para o benchmark (`--strict-mcp-config`,
  config Codex por `-c`).
- Fixture com symlink apontando para fora → recusado na cópia.
- Asserção com `..`/path absoluto/regex catastrófica → rejeitada no schema
  (limite de tamanho do pattern).
- Transcript truncado/corrompido → `error`, não `fail` silencioso nem `pass`.
- Porta do servidor estático ocupada → porta livre escolhida pelo SO.
- `evals/results/` nunca commitado (transcripts podem conter conteúdo de ambiente).
- Host não instalado/não autenticado → `error` por host com mensagem clara; o
  outro host continua.

## 10. Fora de escopo

LLM judge; execução em CI; publicação npm; Cursor/VS Code no benchmark; Figma real.
