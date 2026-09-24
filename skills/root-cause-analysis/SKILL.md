---
name: root-cause-analysis
description: Fix defects by reproducing them, gathering evidence, naming the root cause, adding a regression test and only then fixing. Use for any bug report, failing test or unexpected behavior.
---

# Root Cause Analysis

Sequence, in order and without skipping:

```
reproduce -> evidence -> root cause -> regression test -> fix -> verify
```

## Rules

1. Reproduce first. Get the failure to happen on demand with a command or a test. If you cannot reproduce it, say so and stop guessing.
2. Collect evidence: the exact error, the input, the code path, recent changes to it (`git log`, `git blame`).
3. Name the root cause in one sentence, and state the evidence that separates it from the symptom.
4. Write a regression test that fails for that cause before the fix.
5. Fix the cause, not the symptom. Do not add a guard that hides the failure.
6. Verify: the new test passes, the reproduction no longer fails, the surrounding suite is green (see `verification`).
7. Look for siblings: other places with the same flawed pattern. Report them; fix them only if they are in scope.

## Report

Reproduction, root cause, the test added, the fix, and the verification result.
