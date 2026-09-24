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
