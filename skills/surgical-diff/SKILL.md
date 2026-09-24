---
name: surgical-diff
description: Compare the requested scope with the actual diff before finishing and remove or justify anything unrelated - renames, formatting churn, speculative abstractions, stray comments. Use as the last step before reporting a change as complete.
---

# Surgical Diff

```
requested scope  ~=  actual diff
```

## Procedure

1. Restate the requested scope in one or two lines.
2. Read the full diff (`git diff` and `git status`), not just the file list.
3. Flag every hunk that is not required by the scope:
   - unrelated renames or file moves
   - formatting or whitespace churn in untouched lines
   - speculative abstractions, options or parameters nobody uses yet
   - unrelated comments, dead code, debug output
   - dependency or config changes the task did not need
4. For each flagged hunk: revert it, or justify it in one line if it is genuinely required.
5. Confirm tests still cover the intended change and nothing else was silently dropped.

## Report

`scope check: clean` or a list of the items removed and the items kept with their reason.
