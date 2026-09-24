# Frontend Agent Kit — Design

**Data:** 2026-09-23
**Status:** aprovado para implementação faseada (v0.1 primeiro)

## 1. Objetivo

Kit portátil (Claude Code + Codex) que transforma tarefas de "implemente este Figma"
em um workflow repetível: Figma como fonte de verdade → inspeção do repositório →
reuso de componentes → implementação → validação visual/responsiva/acessibilidade.
Independente de framework de frontend (React, Next.js, Vue, Nuxt, Angular, Tailwind,
PHP, HTML/CSS/JS vanilla, e qualquer outro via auto-bootstrap).

Não é uma skill dentro da Fellowship (`Middle-Earth-Agents`) — é um projeto
independente, com arquitetura "one core + thin host adapters".

## 2. Arquitetura

Três camadas: **Skills** (workflow/decisões), **MCPs** (Figma oficial + MCP próprio
do kit) e **References** (conhecimento condensado). O host (Claude Code/Codex) é só
o executor.

```
frontend-agent-kit/
├── skills/                        ← fonte canônica
│   ├── figma-to-code/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── react.md
│   │       ├── nextjs.md
│   │       ├── vuejs.md
│   │       ├── nuxt.md
│   │       ├── angular.md
│   │       ├── tailwind.md
│   │       ├── php.md
│   │       └── html-css-js.md
│   ├── frontend-design/
│   ├── component-selection/
│   ├── responsive-design/
│   ├── motion-design/
│   ├── accessibility/
│   └── visual-validation/
│
├── packages/
│   ├── mcp-server/                ← v0.2+: Playwright, screenshot, diff, DOM, a11y
│   │   └── src/{index,browser,screenshots,visual-diff,dom,accessibility}.ts
│   └── cli/                       ← v0.4+: installer + HostAdapter
│       └── src/{index,install-claude,install-codex,sync-skills}.ts
│
├── integrations/{claude,codex,cursor,vscode}/
├── evals/
├── examples/demo-app/
├── AGENTS.md
├── CLAUDE.md
├── package.json
└── tsconfig.json
```

Sem remote GitHub por enquanto — repo local em `/home/andre/frontend-agent-kit`.

## 3. Skills canônicas

Cada skill tem `SKILL.md` curto (progressive disclosure) + `references/*.md` no
formato: princípio, quando aplicar, quando não aplicar, exemplo, fonte.

| Skill | Responsabilidade |
|---|---|
| `figma-to-code` | Orquestra o workflow completo (Figma → inspeção → mapping → implementação → validação). Skill "maestro". |
| `frontend-design` | Hierarquia visual, spacing, composição, estados — quando Figma não cobre um detalhe. |
| `component-selection` | Precedência: componente do repo > Code Connect > primitiva do design system > referência externa > criar novo. Nunca instala lib de UI nova sem necessidade concreta. |
| `responsive-design` | Breakpoints, fluid typography, comportamento por viewport. |
| `motion-design` | Hover/focus/transições, `get_motion_context` do Figma, `prefers-reduced-motion`. |
| `accessibility` | Semântica, ARIA, teclado, contraste. Distingue `error` (bloqueia) de `warning` (registra). |
| `visual-validation` | Screenshot → diff → correção, política de convergência (não é só % de similaridade). |

### 3.1. Detecção de stack e auto-alimentação de references

`figma-to-code` sempre começa inspecionando `package.json`/`composer.json`/config
do projeto alvo para detectar o stack. Nenhuma skill hardcoda um framework
específico.

**Base pré-populada no v0.1** (boas práticas gerais, não específicas de projeto,
já que ainda não há Figma real para validar contra): `react.md`, `nextjs.md`,
`vuejs.md`, `nuxt.md`, `angular.md`, `tailwind.md`, `php.md`, `html-css-js.md`.

**Mecanismo de auto-alimentação** (aplica-se sempre, para dentro e fora da base):

- Ao detectar um stack **fora da base** (ex: Svelte, Rails, .NET): a skill infere
  convenções a partir do código já existente no repo + conhecimento geral do
  stack, rascunha `references/<stack>.md` no formato padrão, usa na tarefa atual,
  e persiste no `skills/` canônico do kit (não só localmente).
- Para os 8 stacks **da base**: o auto-bootstrap só **refina** (merge incremental)
  com aprendizados de projetos reais — nunca sobrescreve do zero.
- Todo conteúdo criado/adicionado automaticamente entra marcado
  `status: draft-auto` no frontmatter; a skill avisa numa linha que criou/alterou
  o arquivo. Não bloqueia a tarefa. Promove para `status: reviewed` após revisão
  humana ou uso bem-sucedido repetido em 2-3 projetos diferentes.
- Isso evita que um primeiro projeto com código não-idiomático cristalize um
  anti-padrão como "convenção oficial" do kit sem meio de detectar isso depois.

## 4. Regra de prioridade (Figma como fonte de verdade)

```
1. Figma
2. Design System real do projeto
3. Componentes existentes no código
4. Tokens existentes
5. Regras do Frontend Agent Kit
6. Referências externas (Coss, ReUI, Utopia, Open Props, etc. — catálogo, não dependência)
```

## 5. MCP próprio (`packages/mcp-server`) — v0.2+

Ferramentas: `capture-screenshot`, `compare-screenshots`, `inspect-dom`,
`get-computed-styles`, `run-responsive-suite`, `run-accessibility-audit`.

Stack: Playwright (Chromium headless) + pixelmatch/pngjs + sharp + axe-core.
Registrado via stdio em ambos hosts (`claude mcp add` / `codex mcp add`).

**Segurança:** `capture-screenshot` não aceita URL arbitrária sem guard-rail —
restrito por padrão a `localhost`/hosts explicitamente permitidos via config do
projeto. Nenhuma tool expõe shell arbitrário. Regras completas na seção 9.

## 6. CLI installer + Host Adapters (`packages/cli`) — v0.4+

```ts
interface HostAdapter {
  detect(): Promise<boolean>;
  installSkills(sourceDir: string): Promise<void>;
  installMcp(config: McpConfig): Promise<void>;
  verify(): Promise<VerificationResult>;
}
```

Implementações reais no v0.1→v0.4: `ClaudeCodeAdapter`, `CodexAdapter` (os dois
hosts em uso real). `CursorAdapter`/`VsCodeAdapter` existem como stubs na
interface desde já, sem lógica de instalação real até que esses hosts entrem em
uso de fato.

Comando alvo: `npx frontend-agent-kit install` (auto-detecta) ou
`frontend-agent install claude|codex|--all`. Sincroniza `skills/` canônico →
`.claude/skills/` e `.agents/skills/` (`sync-skills.ts`), nunca apaga skills não
gerenciadas pelo kit (marcadas por manifesto/prefixo).

## 7. Validação — perfis e Definition of Done

Regra de convergência: nunca um único threshold de "% de similaridade" como
critério de aprovação sozinho. Critério composto, configurável por projeto via
`.frontend-agent/config.yml`:

```yaml
validationProfile: standard   # "pixel-perfect" | "standard" (default) | "relaxed"

profiles:
  pixel-perfect:
    # zero divergência nos valores exatos extraídos do Figma (get_variable_defs/
    # get_design_context) comparados aos computed styles do DOM implementado.
    # Pixel diff continua medido e reportado, mas como informação de renderização
    # (anti-aliasing/fontes variam por SO/browser) — não bloqueia sozinho.
    geometryTolerancePx: 0
    spacingTolerancePx: 0
    fontSizeTolerancePx: 0
    maxCriticalA11yIssues: 0
    requireResponsivePass: true
    pixelSimilarityTarget: informational
  standard:
    geometryTolerancePx: 3
    spacingTolerancePx: 2
    fontSizeTolerancePx: 1
    maxCriticalA11yIssues: 0
    requireResponsivePass: true
    pixelSimilarityTarget: 0.95
  relaxed:
    geometryTolerancePx: 8
    spacingTolerancePx: 6
    fontSizeTolerancePx: 2
    maxCriticalA11yIssues: 0
    requireResponsivePass: true
    pixelSimilarityTarget: 0.90
```

`pixel-perfect` é selecionado por projeto (alguns clientes exigem, outros não) —
nunca um modo global do kit.

**Breakpoints padrão** (sobrescrevíveis por projeto):
Desktop 1440×900, Laptop 1280×800, Tablet 768×1024, Mobile 390×844.

**Definition of Done por tarefa:**

```
[ ] Figma context obtido
[ ] screenshot de referência obtido
[ ] variables/tokens verificados
[ ] codebase inspecionado
[ ] componentes existentes reutilizados quando aplicável
[ ] assets reais usados
[ ] implementação compila
[ ] typecheck passa
[ ] lint/test relevante passa
[ ] desktop validado
[ ] tablet validado
[ ] mobile validado
[ ] sem overflow inesperado
[ ] accessibility sem erro crítico
[ ] visual diff executado
[ ] divergências críticas corrigidas
[ ] diferenças conhecidas documentadas (não escondidas)
```

## 8. Evals

JSON com `expected`/`forbidden` por skill. Mínimo 7 cenários base (tela simples,
com componentes existentes, mobile, motion, Figma grande, Figma com asset,
divergência visual proposital) + evals específicos por perfil de stack (8 bases)
e por `validationProfile` (pixel-perfect/standard/relaxed).

## 9. Segurança

- `capture-screenshot` restrito a `localhost`/allowlist por projeto — nunca URL
  arbitrária livre (evita SSRF disfarçado de tool).
- Nenhuma tool expõe shell arbitrário publicamente.
- Schemas estritos (zod) em todas as tools do MCP próprio.
- Tokens/secrets via variáveis de ambiente, nunca em Skills ou logs.
- Tools read-only separadas de write/destructive.
- Validação de paths; sem escrita fora do workspace configurado.

## 10. Roadmap

- **v0.1** — repo base, 7 skills, 8 `references/<stack>.md` pré-populadas, Figma
  MCP configurado, suporte Claude Code + Codex via adapters diretos (sem
  installer ainda — configuração manual).
- **v0.2** — MCP próprio: Playwright, `capture-screenshot`, `inspect-dom`.
- **v0.3** — `compare-screenshots` (pixel + geometry diff), `run-responsive-suite`,
  `run-accessibility-audit`, perfis de validação (pixel-perfect/standard/relaxed).
- **v0.4** — CLI installer, `HostAdapter` completo (Claude/Codex reais,
  Cursor/VSCode como stub), sync automático de skills.
- **v0.5** — eval suite completa, benchmark Claude vs Codex.
- **v1.0** — pacote instalável, docs completas, release versionada.

## 11. Fora de escopo do v0.1 (fica para specs/planos futuros)

- MCP próprio (Playwright/visual-diff/a11y) — v0.2/v0.3.
- CLI installer e sync automático — v0.4.
- Cursor/VS Code com implementação real (não só stub na interface).
- Testes com Figma real (usuário ainda não tem arquivo de teste — v0.1 usa
  fixtures/mocks).

## 12. Fontes

Ver seção 62 do documento original do usuário
(`01c40bab-frontend-agent-kit.md`, consolidado em 22/09/2026): docs oficiais do
Figma MCP, OpenAI/Codex Skills, MCP TypeScript SDK, Claude Agent Skills.
