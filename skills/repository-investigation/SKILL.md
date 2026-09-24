---
name: repository-investigation
description: Build a compact, evidence-backed map of an unfamiliar repository - stack, package manager, real test/lint/typecheck commands, structure and neighboring implementations. Use before planning or editing in any repository you have not mapped yet.
---

# Repository Investigation

Read the repository; do not assume it. Every claim in the map cites a file.

## Steps

1. Stack: read the manifest and config files (`package.json`, `pyproject.toml`, `requirements.txt`, `composer.json`, `Dockerfile`, compose files). Do not assume a framework.
2. Package manager: from the lockfile or the declared field, not from habit.
3. Commands: take test, lint and typecheck commands from the repository's own scripts, Makefile or task runner. Never guess a command when a script exists; if none exists, say so.
4. Structure: list the top-level folders and what each holds.
5. Neighbors: find the closest existing component, service, model, schema or endpoint to the change, and its tests. The new code should look like them.
6. History when useful: `git log -n 5 -- <path>` on the files you will touch, to learn recent intent.
7. If fresh repo memory exists (`repo-memory`), start from it and only re-read what changed.

## Output

Keep it under about 25 lines:

```
STACK        language, frameworks, package manager
COMMANDS     test / lint / typecheck / run, each with its source file
STRUCTURE    folder -> purpose
NEIGHBORS    path:line -> why it is the pattern to follow
RISKS        anything surprising or unverified
```
