# Frontend Agent Kit v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v0.1 slice of the Frontend Agent Kit: repo scaffolding, 7 canonical skills, 8 pre-populated stack references, manual Claude Code/Codex installation docs, and Figma MCP setup instructions — no own MCP server, no CLI installer.

**Architecture:** A canonical `skills/` directory (skills + `references/*.md`) is the single source of truth, validated by a small dependency-free Node script. Installation into Claude Code (`.claude/skills/`) and Codex (`.agents/skills/`) is manual copy in v0.1 (documented in README), matching the "one core + thin host adapters" principle without building the adapter code yet.

**Tech Stack:** Plain Node.js (ESM, zero dependencies), Markdown with YAML-style frontmatter.

**Spec:** `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md`

## Global Constraints

- Node.js runtime, ESM (`"type": "module"` in `package.json`), zero external dependencies in v0.1.
- Reference file format (spec §3.1, §6): frontmatter `name`, `description`, `status: baseline|draft-auto|reviewed`, plus body sections `## Princípio`, `## Quando aplicar`, `## Quando não aplicar`, `## Exemplo`, `## Fonte`.
- Priority order (spec §4): Figma > project's real design system > existing components > existing tokens > this kit's skills > external references.
- Default breakpoints (spec §7): Desktop 1440×900, Laptop 1280×800, Tablet 768×1024, Mobile 390×844 — overridable per project via `.frontend-agent/config.yml`.
- Validation profiles (spec §7): `pixel-perfect` (0px geometry/spacing/font tolerance, pixel similarity informational only), `standard`/default (3/2/1px, target 0.95), `relaxed` (8/6/2px, target 0.90). All profiles require `maxCriticalA11yIssues: 0` and a full responsive pass.
- Out of scope for this plan (spec §11): own MCP server (v0.2/v0.3), CLI installer (v0.4), real Cursor/VS Code adapters, eval suite (v0.5), any work requiring a real Figma file.

---

### Task 1: Repo scaffolding and skill validator

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `scripts/validate-skill.mjs`
- Create: `scripts/fixtures/valid/good-skill/SKILL.md`
- Create: `scripts/fixtures/invalid/bad-skill/SKILL.md`

**Interfaces:**
- Produces: `scripts/validate-skill.mjs`, invoked as `node scripts/validate-skill.mjs <skills-root-dir>`. Exit code `0` when every `SKILL.md` under `<skills-root-dir>` has frontmatter fields `name` and `description` plus a body of at least 50 characters, and every `references/*.md` file has frontmatter fields `name`, `description`, `status` plus the five required `##` sections. Exit code `1` otherwise, with each problem printed to stderr.
- Consumed by: every later task in this plan, via `node scripts/validate-skill.mjs skills`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "frontend-agent-kit",
  "private": true,
  "type": "module",
  "scripts": {
    "validate:skills": "node scripts/validate-skill.mjs skills"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.frontend-agent/
*.log
```

- [ ] **Step 3: Write the fixture files first (they define what the validator must accept and reject)**

`scripts/fixtures/valid/good-skill/SKILL.md`:

```markdown
---
name: good-skill
description: A fixture skill used to verify the validator accepts well-formed skills.
---

# Good Skill

This is a fixture SKILL.md with a frontmatter block containing both required
fields and a body long enough to pass the minimum length check used by
scripts/validate-skill.mjs.
```

`scripts/fixtures/invalid/bad-skill/SKILL.md`:

```markdown
---
name: bad-skill
---

Too short.
```

- [ ] **Step 4: Run the validator against the fixtures to confirm it fails on the bad one**

Run: `node scripts/validate-skill.mjs scripts/fixtures/invalid`
Expected: exits non-zero; the script does not exist yet, so this will currently fail with a "module not found" error. That confirms there is nothing already passing — proceed to implement.

- [ ] **Step 5: Implement `scripts/validate-skill.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_REF_SECTIONS = [
  '## Princípio',
  '## Quando aplicar',
  '## Quando não aplicar',
  '## Exemplo',
  '## Fonte'
];

function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n+/, '');
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields, body };
}

function validateSkillFile(path) {
  const errors = [];
  const content = readFileSync(path, 'utf8');
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    errors.push(`${path}: missing frontmatter (must start with "---")`);
    return errors;
  }
  if (!parsed.fields.name) errors.push(`${path}: frontmatter missing "name"`);
  if (!parsed.fields.description) errors.push(`${path}: frontmatter missing "description"`);
  if (parsed.body.trim().length < 50) errors.push(`${path}: body too short (< 50 chars)`);
  return errors;
}

function validateReferenceFile(path) {
  const errors = [];
  const content = readFileSync(path, 'utf8');
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    errors.push(`${path}: missing frontmatter (must start with "---")`);
    return errors;
  }
  if (!parsed.fields.name) errors.push(`${path}: frontmatter missing "name"`);
  if (!parsed.fields.description) errors.push(`${path}: frontmatter missing "description"`);
  if (!parsed.fields.status) errors.push(`${path}: frontmatter missing "status"`);
  for (const section of REQUIRED_REF_SECTIONS) {
    if (!parsed.body.includes(section)) errors.push(`${path}: missing section "${section}"`);
  }
  return errors;
}

function findSkillDirs(root) {
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
}

function main() {
  const skillsRoot = process.argv[2] ?? 'skills';
  let errors = [];
  for (const skillName of findSkillDirs(skillsRoot)) {
    const skillDir = join(skillsRoot, skillName);
    const skillFile = join(skillDir, 'SKILL.md');
    try {
      statSync(skillFile);
    } catch {
      errors.push(`${skillDir}: missing SKILL.md`);
      continue;
    }
    errors = errors.concat(validateSkillFile(skillFile));

    const refsDir = join(skillDir, 'references');
    try {
      const refFiles = readdirSync(refsDir).filter((f) => f.endsWith('.md'));
      for (const refFile of refFiles) {
        errors = errors.concat(validateReferenceFile(join(refsDir, refFile)));
      }
    } catch {
      // no references/ dir is fine — not all skills have one
    }
  }

  if (errors.length > 0) {
    console.error(`validate-skill: ${errors.length} problem(s) found:\n`);
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log('validate-skill: all skills valid.');
  process.exit(0);
}

main();
```

- [ ] **Step 6: Run the validator against the invalid fixture, confirm it fails with the expected messages**

Run: `node scripts/validate-skill.mjs scripts/fixtures/invalid`
Expected: exit code `1`; stderr includes `frontmatter missing "description"` for `scripts/fixtures/invalid/bad-skill/SKILL.md`.

- [ ] **Step 7: Run the validator against the valid fixture, confirm it passes**

Run: `node scripts/validate-skill.mjs scripts/fixtures/valid`
Expected: exit code `0`; stdout prints `validate-skill: all skills valid.`

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore scripts/
git commit -m "Add repo scaffolding and skill/reference validator script"
```

---

### Task 2: `figma-to-code` skill

**Files:**
- Create: `skills/figma-to-code/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).
- Produces: the orchestrating skill other skills are delegated from by name (`frontend-design`, `component-selection`, `responsive-design`, `motion-design`, `accessibility`, `visual-validation` — implemented in Tasks 3-8).

- [ ] **Step 1: Write `skills/figma-to-code/SKILL.md`**

```markdown
---
name: figma-to-code
description: Implements frontend interfaces from Figma designs with high visual fidelity, detecting the target framework and orchestrating validation. Use when a task references a Figma frame, Figma URL, or a design-to-code implementation request.
---

# Figma to Code

Treat Figma as the primary source of truth. When Figma does not define something, defer to `frontend-design`.

## Priority order

1. Figma
2. Project's real design system
3. Existing components in the codebase
4. Existing design tokens
5. Frontend Agent Kit skills (this kit)
6. External references (catalog only, never a source of truth)

## Workflow

1. Receive the task: Figma URL, target framework/stack, target file/route, extra requirements.
2. Detect the project's stack by reading its config files (`package.json`, `composer.json`, or the absence of any — plain HTML/CSS/JS). Do not assume a framework.
3. Load the stack reference at `references/<stack>.md`. If it does not exist yet:
   - Infer conventions from the existing code in the repository plus general knowledge of that stack.
   - Draft `references/<stack>.md` following the standard reference format (see `component-selection` skill for the format).
   - Mark the new file's frontmatter with `status: draft-auto`.
   - Tell the user, in one line, that a new stack reference was created and should be reviewed.
   - Continue the task using the freshly drafted reference.
4. If the stack is one of the 8 pre-populated bases (react, nextjs, vuejs, nuxt, angular, tailwind, php, html-css-js) and the task reveals a convention that diverges from the existing reference, merge the learning into the file incrementally (never overwrite from scratch) and keep/set `status: draft-auto` on the changed section until reviewed.
5. Inspect the repository: existing components, design tokens, theme, routing, CSS approach, lint/test/typecheck commands.
6. Call the Figma MCP for design context, screenshot and variable/token definitions (`get_design_context`, `get_screenshot`, `get_variable_defs`). Use `get_metadata`, `get_motion_context`, `download_assets` or Code Connect data when relevant.
7. Build a mapping from Figma nodes to existing repository components and tokens. Use the `component-selection` skill's precedence rule before creating anything new.
8. Implement the page/component, using real Figma assets — never placeholder assets when real ones are available.
9. Run the application and capture a screenshot at the target viewport (delegates to `visual-validation`).
10. Run visual validation and fix meaningful mismatches, following the project's configured `validationProfile` (`pixel-perfect`, `standard` or `relaxed` — default `standard`).
11. Validate desktop, tablet and mobile breakpoints (delegates to `responsive-design`).
12. Run accessibility checks (delegates to `accessibility`).
13. Run the project's own lint/typecheck/test/build commands when available.
14. Do not report the task as finished until the Definition of Done checklist below is satisfied or remaining differences are explicitly documented.

## Definition of Done

- [ ] Figma context obtained
- [ ] Reference screenshot obtained
- [ ] Variables/tokens verified
- [ ] Codebase inspected
- [ ] Existing components reused where applicable
- [ ] Real assets used
- [ ] Implementation compiles
- [ ] Typecheck passes
- [ ] Relevant lint/test passes
- [ ] Desktop, tablet and mobile validated
- [ ] No unexpected overflow
- [ ] No critical accessibility errors
- [ ] Visual diff executed
- [ ] Critical divergences fixed
- [ ] Remaining known differences documented (never hidden)

## Rules

- Never replace provided Figma assets with placeholders.
- Do not introduce a new UI library without a concrete need.
- Prefer the repository's design system over external examples.
- External references are fallbacks, not sources of truth.
- Do not finish before visual validation succeeds or remaining differences are documented.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/SKILL.md
git commit -m "Add figma-to-code skill"
```

---

### Task 3: `frontend-design` skill

**Files:**
- Create: `skills/frontend-design/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).
- Produces: heuristics `figma-to-code` (Task 2) falls back to when Figma leaves a detail undefined.

- [ ] **Step 1: Write `skills/frontend-design/SKILL.md`**

```markdown
---
name: frontend-design
description: General UI heuristics for hierarchy, spacing, composition and interface states, used when Figma does not fully specify a detail. Use alongside figma-to-code, or standalone for non-Figma UI work.
---

# Frontend Design

Apply when there is no Figma source, or Figma does not define a specific detail (e.g. a hover state, an empty state, an error state).

## Heuristics

1. Visual hierarchy: one primary action per view; secondary actions visually subordinate.
2. Spacing: use the project's existing spacing scale/tokens; never invent arbitrary pixel values when a token exists.
3. Density: match the density of the surrounding screens in the same product, not a generic default.
4. Composition: group related fields/actions; keep unrelated elements visually separated.
5. States: every interactive element needs a default, hover/focus, active, disabled and (when relevant) loading/error state — even when Figma only shows the default state.
6. Consistency: reuse the same component/pattern for the same kind of interaction across the app, rather than introducing a new one-off pattern.

## When not to apply

- When Figma explicitly defines the detail in question — Figma wins (see `figma-to-code` priority order).
- When the repository has an established pattern that conflicts with a generic heuristic here — the repository's real pattern wins.

## Rules

- Do not invent a new color, spacing or type value when an existing token covers the case.
- Do not add a UI pattern that has no precedent in the codebase without flagging it as a deliberate new pattern.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/frontend-design/SKILL.md
git commit -m "Add frontend-design skill"
```

---

### Task 4: `component-selection` skill

**Files:**
- Create: `skills/component-selection/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).
- Produces: the reference-file format contract that Tasks 9-16 must follow, and the auto-bootstrap rule `figma-to-code` (Task 2) points to.

- [ ] **Step 1: Write `skills/component-selection/SKILL.md`**

```markdown
---
name: component-selection
description: Decides between reusing an existing component and creating a new one, and defines the reference-file format used across the kit. Use whenever implementation requires a UI component, in Figma or non-Figma work.
---

# Component Selection

## Precedence rule

```
if repository already has a matching component:
    reuse it
elif Figma maps the node through Code Connect:
    reuse the mapped component
elif the project's design system has an equivalent primitive:
    compose the component from that primitive
else:
    create a new component, following the project's existing conventions
```

Only after all four steps fail, consult external references (component.gallery, Coss, ReUI) as inspiration for how to implement the new component — never as a dependency to install automatically.

## Reference file format

Every `references/*.md` file in this kit (stack references, pattern references) follows this structure:

```markdown
---
name: <slug>
description: <one line>
status: baseline | draft-auto | reviewed
---

## Princípio
<the rule itself>

## Quando aplicar
<the situations where it applies>

## Quando não aplicar
<the situations where it does not apply>

## Exemplo
<a concrete code or usage example>

## Fonte
<where this came from: official docs, repo convention, etc.>
```

## Auto-bootstrap of stack references

When `figma-to-code` detects a stack with no `references/<stack>.md`:

1. It infers conventions from the existing repository code and general knowledge of the stack.
2. It writes a new file in this format, with `status: draft-auto`.
3. For the 8 pre-populated base stacks (react, nextjs, vuejs, nuxt, angular, tailwind, php, html-css-js), new learnings are merged into the existing file instead of overwriting it, and the changed section keeps `status: draft-auto` until a human reviews it or it succeeds across 2-3 different projects.

## Rules

- Never install a new UI library (e.g. shadcn, MUI, a component pack) without a concrete, stated need — the repository's existing library always wins by default.
- Never create a component that duplicates an existing one under a different name.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/component-selection/SKILL.md
git commit -m "Add component-selection skill"
```

---

### Task 5: `responsive-design` skill

**Files:**
- Create: `skills/responsive-design/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).
- Produces: the breakpoint table and workflow `figma-to-code` (Task 2, step 11) delegates to.

- [ ] **Step 1: Write `skills/responsive-design/SKILL.md`**

```markdown
---
name: responsive-design
description: Breakpoints, fluid typography and layout reflow rules for validating and implementing responsive behavior. Use whenever a UI implementation needs to be checked or built across multiple viewport sizes.
---

# Responsive Design

## Default breakpoints

| Name | Width x Height |
|---|---|
| Desktop | 1440 x 900 |
| Laptop | 1280 x 800 |
| Tablet | 768 x 1024 |
| Mobile | 390 x 844 |

Projects may override these in `.frontend-agent/config.yml` under a `breakpoints:` key — when present, the project's values always win over these defaults.

## Workflow

1. Read `.frontend-agent/config.yml` for project-specific breakpoints; fall back to the defaults above.
2. After implementing a view, check it at each configured breakpoint.
3. Verify: no horizontal scroll/overflow, no clipped or overlapping content, touch targets remain usable on mobile widths, navigation collapses/adapts as expected.
4. For typography and spacing that scale fluidly, follow the project's existing fluid-scale tokens if present; otherwise use CSS `clamp()` bound to the project's type scale rather than fixed per-breakpoint values.

## Rules

- A layout that only works at the exact Figma frame width is not done — it must reflow sanely at every configured breakpoint.
- Do not hardcode breakpoint values inline when the project already defines them as tokens/variables.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/responsive-design/SKILL.md
git commit -m "Add responsive-design skill"
```

---

### Task 6: `motion-design` skill

**Files:**
- Create: `skills/motion-design/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).

- [ ] **Step 1: Write `skills/motion-design/SKILL.md`**

```markdown
---
name: motion-design
description: Hover, focus, enter/exit and microinteraction rules, including reduced-motion handling. Use when a design specifies animation/transition behavior, or when interactive elements need a coherent motion treatment Figma does not define.
---

# Motion Design

## Workflow

1. If Figma defines motion for the target node, call the Figma MCP's `get_motion_context` after `get_design_context`, and reproduce the returned keyframes/easing/timing exactly.
2. If Figma does not define motion for an interactive element, choose a coherent default: hover/focus transitions in the 120-200ms range, standard ease-out for entrances, ease-in for exits — matching any motion already used elsewhere in the project.
3. Always implement keyboard focus states, not just mouse hover — focus must be visibly distinct.
4. Wrap non-essential motion (decorative transitions, parallax, autoplay animation) in:

```css
@media (prefers-reduced-motion: reduce) {
  /* disable or drastically shorten non-essential motion */
}
```

Essential motion that communicates state change (e.g. a loading spinner) may remain, but should still be reduced/simplified under this media query when possible.

## Rules

- Never introduce a motion library dependency for a single simple transition achievable in CSS.
- Do not skip `prefers-reduced-motion` handling on new non-essential animations.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/motion-design/SKILL.md
git commit -m "Add motion-design skill"
```

---

### Task 7: `accessibility` skill

**Files:**
- Create: `skills/accessibility/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).
- Produces: the error/warning severity split `figma-to-code` (Task 2, step 12) delegates to.

- [ ] **Step 1: Write `skills/accessibility/SKILL.md`**

```markdown
---
name: accessibility
description: Semantic HTML, ARIA, keyboard and contrast rules, plus the error/warning severity split used to gate task completion. Use on every UI implementation task, Figma-based or not.
---

# Accessibility

## Workflow

1. Prefer semantic HTML elements (`button`, `nav`, `main`, `label`, heading levels in order) over generic `div`/`span` with ARIA bolted on.
2. Add ARIA only when semantic HTML cannot express the pattern (e.g. a custom combobox).
3. Every interactive element must be reachable and operable by keyboard alone, with a visible focus state.
4. Every form input needs a programmatically associated label.
5. Verify text/background color contrast against the project's actual token values, not just the Figma preview colors (rendering can differ).
6. Run the project's accessibility audit tooling when available (e.g. via the `visual-validation` skill's browser tooling once the kit's own MCP is installed in v0.2+; until then, review manually against this checklist).

## Severity split

- **error** (blocks task completion): a button/link with no accessible name, an input with no label, a critical contrast failure, a heading hierarchy that skips levels in a way that breaks screen-reader navigation, an interactive element unreachable by keyboard.
- **warning** (recorded, evaluated, does not block): minor contrast issues on non-critical text, missing but non-essential `aria-describedby`, redundant ARIA that doesn't break anything.

## Rules

- Do not report a UI task as done while any `error`-severity issue remains open.
- Document `warning`-severity issues in the task's validation summary rather than silently dropping them.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/accessibility/SKILL.md
git commit -m "Add accessibility skill"
```

---

### Task 8: `visual-validation` skill

**Files:**
- Create: `skills/visual-validation/SKILL.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1).
- Produces: the validation-profile table `figma-to-code` (Task 2, step 10) delegates to.

- [ ] **Step 1: Write `skills/visual-validation/SKILL.md`**

```markdown
---
name: visual-validation
description: Screenshot-and-diff loop against the Figma reference, using a composite convergence policy instead of a single similarity threshold. Use after implementing any Figma-sourced UI, before considering the task complete.
---

# Visual Validation

Visual review is a required test, not an optional nice-to-have. A task that compiles and passes unit tests can still be visually wrong.

## Loop

```
implement -> render -> screenshot -> diff -> issues found?
  yes -> fix -> render again
  no  -> finish
```

## Validation profiles

Read `validationProfile` from `.frontend-agent/config.yml` (default: `standard`).

| Profile | geometryTolerancePx | spacingTolerancePx | fontSizeTolerancePx | pixelSimilarityTarget |
|---|---|---|---|---|
| pixel-perfect | 0 | 0 | 0 | informational only |
| standard (default) | 3 | 2 | 1 | 0.95 |
| relaxed | 8 | 6 | 2 | 0.90 |

All profiles require `maxCriticalA11yIssues: 0` and a full responsive pass.

In every profile, pixel similarity alone is never sufficient to approve or reject: font rendering differs across operating systems and browsers, so a passing pixel score can hide a real layout bug, and a low pixel score can be pure rendering noise. Always cross-check with:

- Geometry (position, width, height) against the Figma frame.
- Computed styles (font-size, line-height, color, border-radius, spacing) against Figma's variable/token values.

## Fix priority order

1. Layout macro-structure
2. Geometry
3. Spacing
4. Typography
5. Colors
6. Borders/shadows
7. Microdetails

## Rules

- Never approve a task based on pixel similarity percentage alone.
- Document every remaining known difference in the task's summary instead of silently ignoring it.
- Re-render and re-diff after every fix, don't assume a fix worked without re-checking.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/visual-validation/SKILL.md
git commit -m "Add visual-validation skill"
```

---

### Task 9: `react.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/react.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/react.md`**

```markdown
---
name: react
description: Baseline conventions for implementing Figma designs in React (with TypeScript).
status: baseline
---

## Princípio

Build UI as small, typed function components; keep presentational components free of data-fetching logic; colocate a component's styles/tests next to its file.

## Quando aplicar

Any project whose `package.json` lists `react` as a dependency without `next` (plain React + Vite/CRA/other bundler).

## Quando não aplicar

Projects using Next.js — use `nextjs.md` instead, since routing/data-fetching conventions differ (Server/Client Components).

## Exemplo

```tsx
interface CardProps {
  title: string;
  description: string;
  onSelect: () => void;
}

export function Card({ title, description, onSelect }: CardProps) {
  return (
    <article className="card" onClick={onSelect}>
      <h3 className="card__title">{title}</h3>
      <p className="card__description">{description}</p>
    </article>
  );
}
```

Map a Figma component instance to a props interface built from its variant/property list; prefer composition (children) over prop explosion for layout slots.

## Fonte

React docs (react.dev) general component conventions; refined per-project via the auto-bootstrap mechanism described in `component-selection/SKILL.md`.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/react.md
git commit -m "Add react stack reference"
```

---

### Task 10: `nextjs.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/nextjs.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/nextjs.md`**

```markdown
---
name: nextjs
description: Baseline conventions for implementing Figma designs in Next.js (App Router).
status: baseline
---

## Princípio

Default to Server Components; only mark a component `'use client'` when it needs state, effects, or browser-only APIs. Keep route-level layout in `layout.tsx`, page content in `page.tsx`.

## Quando aplicar

Projects whose `package.json` lists `next` as a dependency.

## Quando não aplicar

Plain React projects without Next.js routing — use `react.md`. Pages Router projects (`pages/` directory present, no `app/`) follow the same component conventions but route files live under `pages/`, not `app/`.

## Exemplo

```tsx
// app/products/[id]/page.tsx — Server Component by default
export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  return <ProductDetail product={product} />;
}

// components/AddToCartButton.tsx — needs interactivity
'use client';
export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false);
  // ...
}
```

## Fonte

Next.js docs (App Router conventions); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/nextjs.md
git commit -m "Add nextjs stack reference"
```

---

### Task 11: `vuejs.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/vuejs.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/vuejs.md`**

```markdown
---
name: vuejs
description: Baseline conventions for implementing Figma designs in Vue 3.
status: baseline
---

## Princípio

Use `<script setup>` with the Composition API; define props/emits with `defineProps`/`defineEmits` and TypeScript types; keep single-file components focused on one UI responsibility.

## Quando aplicar

Projects whose `package.json` lists `vue` as a dependency without `nuxt`.

## Quando não aplicar

Nuxt projects — use `nuxt.md`, since routing/SSR conventions differ (file-based pages, auto-imports).

## Exemplo

```vue
<script setup lang="ts">
interface Props {
  title: string;
  description: string;
}
const props = defineProps<Props>();
const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <article class="card" @click="emit('select')">
    <h3 class="card__title">{{ title }}</h3>
    <p class="card__description">{{ description }}</p>
  </article>
</template>
```

## Fonte

Vue 3 docs (Composition API, `<script setup>`); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/vuejs.md
git commit -m "Add vuejs stack reference"
```

---

### Task 12: `nuxt.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/nuxt.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/nuxt.md`**

```markdown
---
name: nuxt
description: Baseline conventions for implementing Figma designs in Nuxt 3.
status: baseline
---

## Princípio

Use file-based routing under `pages/`, shared layout in `layouts/`, rely on Nuxt's auto-imports for components/composables instead of manual imports; use `useFetch`/`useAsyncData` for data loading over raw `fetch` in components.

## Quando aplicar

Projects whose `package.json` lists `nuxt` as a dependency.

## Quando não aplicar

Plain Vue 3 projects without Nuxt — use `vuejs.md`.

## Exemplo

```vue
<!-- pages/products/[id].vue -->
<script setup lang="ts">
const route = useRoute();
const { data: product } = await useFetch(`/api/products/${route.params.id}`);
</script>

<template>
  <ProductDetail v-if="product" :product="product" />
</template>
```

`ProductDetail` here is auto-imported from `components/ProductDetail.vue` — do not add a manual import for components already under Nuxt's auto-import roots.

## Fonte

Nuxt 3 docs (auto-imports, data fetching, file-based routing); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/nuxt.md
git commit -m "Add nuxt stack reference"
```

---

### Task 13: `angular.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/angular.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/angular.md`**

```markdown
---
name: angular
description: Baseline conventions for implementing Figma designs in Angular.
status: baseline
---

## Princípio

Prefer standalone components over NgModules for new UI (current Angular default); keep templates declarative, push data-fetching into services/resolvers rather than component constructors; use `@Input()`/`@Output()` with explicit types for component contracts.

## Quando aplicar

Projects whose `package.json` lists `@angular/core` as a dependency.

## Quando não aplicar

Non-Angular projects — see the matching stack reference instead.

## Exemplo

```ts
@Component({
  selector: 'app-card',
  standalone: true,
  template: `
    <article class="card" (click)="select.emit()">
      <h3 class="card__title">{{ title }}</h3>
      <p class="card__description">{{ description }}</p>
    </article>
  `
})
export class CardComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) description!: string;
  @Output() select = new EventEmitter<void>();
}
```

## Fonte

Angular docs (standalone components, current recommended patterns); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/angular.md
git commit -m "Add angular stack reference"
```

---

### Task 14: `tailwind.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/tailwind.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/tailwind.md`**

```markdown
---
name: tailwind
description: Baseline conventions for styling Figma implementations with Tailwind CSS.
status: baseline
---

## Princípio

Map Figma variables/tokens to the project's `tailwind.config` theme extensions (colors, spacing, font sizes) instead of using arbitrary value syntax (`w-[123px]`) by default; reserve arbitrary values for one-off cases with no matching token.

## Quando aplicar

Projects whose `package.json` lists `tailwindcss` as a dependency, regardless of the JS framework used alongside it.

## Quando não aplicar

Projects using a different styling approach (CSS Modules, styled-components, plain CSS/SCSS, a separate design-system's own class API) — check the project's actual styling setup before assuming Tailwind, even if a Figma reference mentions utility classes.

## Exemplo

```html
<!-- Figma variable color/brand/500 maps to theme.colors.brand[500] -->
<button class="bg-brand-500 px-4 py-2 rounded-md text-white hover:bg-brand-600">
  Add to cart
</button>
```

```js
// tailwind.config.js
theme: {
  extend: {
    colors: { brand: { 500: '#4f46e5', 600: '#4338ca' } }
  }
}
```

## Fonte

Tailwind CSS docs (theme configuration); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/tailwind.md
git commit -m "Add tailwind stack reference"
```

---

### Task 15: `php.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/php.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/php.md`**

```markdown
---
name: php
description: Baseline conventions for implementing Figma designs in PHP projects (Laravel/Blade, or plain PHP templates).
status: baseline
---

## Princípio

In Laravel projects, implement UI as Blade components/partials under `resources/views/components/`, passing typed data from controllers; avoid inline business logic in templates. In plain PHP projects, separate template files from data-fetching/business logic explicitly (no direct DB queries inside a view file).

## Quando aplicar

Projects with a `composer.json` present, or `.php` template files with no JS framework driving the UI.

## Quando não aplicar

Laravel projects using Inertia.js to render React/Vue — in that case, follow `react.md`/`vuejs.md` for the actual component code, and treat this reference only for the PHP-side controller/route conventions.

## Exemplo

```blade
{{-- resources/views/components/card.blade.php --}}
@props(['title', 'description'])
<article class="card">
  <h3 class="card__title">{{ $title }}</h3>
  <p class="card__description">{{ $description }}</p>
</article>
```

```blade
<x-card :title="$product->name" :description="$product->summary" />
```

## Fonte

Laravel docs (Blade components); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/php.md
git commit -m "Add php stack reference"
```

---

### Task 16: `html-css-js.md` stack reference

**Files:**
- Create: `skills/figma-to-code/references/html-css-js.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), reference format from Task 4.

- [ ] **Step 1: Write `skills/figma-to-code/references/html-css-js.md`**

```markdown
---
name: html-css-js
description: Baseline conventions for implementing Figma designs with plain HTML, CSS and JavaScript (no framework).
status: baseline
---

## Princípio

Use semantic HTML elements matching the Figma layer's real role (not `div` for everything); scope component styles with a clear naming convention (e.g. BEM) when there is no build-time CSS scoping tool; keep DOM-manipulation JavaScript in small, named functions attached via `addEventListener`, not inline `onclick` attributes.

## Quando aplicar

Projects with no frontend framework dependency in `package.json` (or no `package.json` at all) — static sites, server-rendered templates without a JS framework layer.

## Quando não aplicar

Any project that already depends on React/Vue/Angular/etc. — use the matching stack reference instead, even for a single "simple" page inside a larger framework-based app.

## Exemplo

```html
<article class="card">
  <h3 class="card__title">Product name</h3>
  <p class="card__description">Short summary</p>
  <button class="card__action" type="button">Add to cart</button>
</article>
```

```js
document.querySelectorAll('.card__action').forEach((btn) => {
  btn.addEventListener('click', () => addToCart(btn.closest('.card').dataset.productId));
});
```

## Fonte

MDN Web Docs (semantic HTML, event handling); refined per-project via auto-bootstrap.
```

- [ ] **Step 2: Validate**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add skills/figma-to-code/references/html-css-js.md
git commit -m "Add html-css-js stack reference"
```

---

### Task 17: Root and per-host instruction files

**Files:**
- Create: `CLAUDE.md`
- Create: `AGENTS.md`
- Create: `integrations/claude/CLAUDE.md`
- Create: `integrations/codex/AGENTS.md`

**Interfaces:**
- Consumes: nothing (plain instruction files, not validated by `scripts/validate-skill.mjs`).
- Produces: the files a consumer project copies in during manual installation (Task 18).

- [ ] **Step 1: Write `CLAUDE.md`**

```markdown
# Frontend Agent Kit

Use the frontend skills available in `.claude/skills/` (installed from this kit's canonical `skills/` directory).

For Figma implementation tasks:

1. Treat Figma as the design source of truth.
2. Reuse existing repository components before creating new components.
3. Use the Figma MCP for design context, variables, screenshots and assets.
4. Use the frontend-agent MCP for browser validation and visual diff, once installed (v0.2+).
5. Run visual and responsive validation before considering the task complete.
```

- [ ] **Step 2: Write `AGENTS.md`**

```markdown
# Frontend repository instructions

## Mandatory workflow

- For tasks containing a Figma link, use the `figma-to-code` skill.
- Reuse repository components and tokens before introducing new primitives.
- Use Figma MCP design context and screenshots as the source of truth.
- Validate implemented UI through the frontend-agent MCP once installed (v0.2+).
- Run responsive and accessibility validation before finishing substantial UI work.

## Validation

- Run the existing project's test commands.
- Run type checking.
- Run linting when configured.
- For visual work, validate the configured target viewports.
```

- [ ] **Step 3: Copy both into `integrations/`**

```bash
mkdir -p integrations/claude integrations/codex
cp CLAUDE.md integrations/claude/CLAUDE.md
cp AGENTS.md integrations/codex/AGENTS.md
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md integrations/
git commit -m "Add root and per-host instruction files"
```

---

### Task 18: README with install instructions and final validation

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: `scripts/validate-skill.mjs` (Task 1), `integrations/claude/CLAUDE.md` and `integrations/codex/AGENTS.md` (Task 17).

- [ ] **Step 1: Write `README.md`**

```markdown
# Frontend Agent Kit

Portable Figma-to-code agent kit for Claude Code and Codex: skills, stack references and (from v0.2 onward) an own MCP server for visual validation.

## What's in v0.1

- 7 canonical skills under `skills/`, covering the full Figma-to-code workflow, component reuse, responsive design, motion, accessibility and visual validation.
- 8 pre-populated stack references (`skills/figma-to-code/references/`): React, Next.js, Vue 3, Nuxt, Angular, Tailwind CSS, PHP/Laravel, plain HTML/CSS/JS. New stacks are bootstrapped automatically the first time a task needs them (see `skills/component-selection/SKILL.md`).
- Manual installation into Claude Code and Codex (no CLI installer yet — that's v0.4).
- Figma's official MCP server configuration (design context, screenshots, variables, assets).

Not yet included: the kit's own MCP server (screenshots, visual diff, accessibility audit — v0.2/v0.3) and the CLI installer (v0.4). See `docs/superpowers/specs/2026-09-23-frontend-agent-kit-design.md` for the full roadmap.

## Install into a target project (manual, v0.1)

From your target project's root:

```bash
mkdir -p .claude/skills .agents/skills
cp -r /path/to/frontend-agent-kit/skills/* .claude/skills/
cp -r /path/to/frontend-agent-kit/skills/* .agents/skills/
cp /path/to/frontend-agent-kit/integrations/claude/CLAUDE.md ./CLAUDE.md
cp /path/to/frontend-agent-kit/integrations/codex/AGENTS.md ./AGENTS.md
```

If `CLAUDE.md`/`AGENTS.md` already exist in the target project, merge the "Mandatory workflow" section manually instead of overwriting.

## Configure the Figma MCP

Claude Code, current project:

```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

Claude Code, all projects (user scope):

```bash
claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp
```

Codex CLI:

```bash
codex mcp add figma --url https://mcp.figma.com/mcp
```

After adding, authenticate when prompted and confirm the server is connected (`/mcp` in Claude Code, `codex mcp list` in Codex).

## Validate the kit's own skills

```bash
node scripts/validate-skill.mjs skills
```

Checks every `SKILL.md` has valid frontmatter (`name`, `description`) and a non-trivial body, and every `references/*.md` has the required frontmatter (`name`, `description`, `status`) and sections (`Princípio`, `Quando aplicar`, `Quando não aplicar`, `Exemplo`, `Fonte`).
```

- [ ] **Step 2: Run the full validation suite as the v0.1 acceptance check**

Run: `node scripts/validate-skill.mjs skills`
Expected: exit code `0`, stdout `validate-skill: all skills valid.` — this confirms all 7 skills and all 8 stack references created across Tasks 2-16 are well-formed together, not just individually.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README with install instructions and Figma MCP setup"
```

---

## Self-review notes

- **Spec coverage:** §2 (architecture/repo layout) → Task 1, 17; §3 (7 skills) → Tasks 2-8; §3.1 (stack detection, auto-bootstrap, 8 base references) → Tasks 2, 4, 9-16; §4 (priority order) → Task 2; §7 (validation profiles, breakpoints, DoD) → Tasks 2, 5, 8; §10 v0.1 roadmap line → all tasks; §11 (out of scope) → intentionally no tasks for MCP server, CLI installer, evals, non-stub Cursor/VS Code. §5 (own MCP) and §6 (CLI/adapters) are v0.2+/v0.4 and correctly excluded.
- **Placeholder scan:** no TBD/TODO; every step has literal file content or an exact command with expected output.
- **Type/name consistency:** `scripts/validate-skill.mjs`'s CLI contract (`node scripts/validate-skill.mjs <root>`, exit 0/1) is used identically across Tasks 2-18. The reference frontmatter fields (`name`, `description`, `status`) and section headers match between Task 4's documented format and Tasks 9-16's actual files.
