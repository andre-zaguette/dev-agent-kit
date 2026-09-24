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
