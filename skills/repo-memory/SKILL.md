---
name: repo-memory
description: Persist and revalidate stable repository knowledge under .dev-agent/knowledge, each file stamped with the source commit SHA, so later tasks skip rediscovery without trusting stale facts. Use after investigating a repository and before repeating an investigation.
---

# Repo Memory

Stable facts about a repository, cached locally so the next task does not rediscover them.

## Files

```
.dev-agent/knowledge/
  repository.md    stack, package manager, structure
  architecture.md  boundaries, service map, patterns
  frontend.md      design system location, component conventions
  backend.md       service boundaries, data and job conventions
  commands.md      test / lint / typecheck / run commands and their sources
```

Every file starts with:

```yaml
---
sourceSha: abc1234abcde
updatedAt: 2026-09-24T14:00:00Z
---
```

`sourceSha` is `git rev-parse --short=12 HEAD` at the time the facts were verified.

## Using memory

1. Read the file and compare `sourceSha` with the current `git rev-parse --short=12 HEAD`.
2. Equal: trust it.
3. Different: run `git diff --name-only <sourceSha> HEAD`. Revalidate only the sections that mention changed files, then update the file and its `sourceSha`.
4. `sourceSha` not found in history, or not a git repository: treat the file as stale and regenerate it.

## Never cache

- Secrets, tokens, credentials or private URLs.
- Task-specific state or progress. That belongs in the task ledger, not here.
- Anything you did not verify in the repository.
