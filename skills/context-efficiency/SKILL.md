---
name: context-efficiency
description: Keep agent context small without lowering correctness - load only task-relevant skills, keep subagent reports compact and structured, reuse fresh repository memory. Use at the start of a task and whenever delegating work.
---

# Context Efficiency

Use the minimum context required to make the correct decision. Not the fewest tokens possible.

## Rules

- Load only the skills the task needs. Do not load frontend references for a backend task, or the reverse.
- Load a reference only when the stack it covers is present in the repository.
- Do not re-derive repository facts that fresh repo memory already holds (see `repo-memory`); re-read only what changed.
- Never compress code, error messages, commands or file paths. Compress prose only, and only where meaning survives.
- Do not restate to the user or to a subagent what is already visible in the conversation.

## Subagent reports

Ask for a structured, low-noise report:

```
FILES     path: role
PATTERN   the convention found
RISK      what could go wrong
NEXT      the single next action
```

Reject long narrative reports; ask for the structure instead.

## When unsure

Prefer one more targeted read over a guess. Correctness outranks economy.
