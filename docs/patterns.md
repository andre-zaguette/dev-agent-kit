# Following existing patterns

The kit does not guess your conventions: it reads them from the repository and hands them to the agent.

## Asking for it

Say what you want in plain words, for example "add an archive endpoint for notes, following the existing pattern". The agent runs:

1. `dev-agent repo index --write` (once, or when knowledge is stale) to draft `.dev-agent/knowledge/*.md`.
2. `dev-agent repo similar add archive endpoint for notes` to list the closest existing features and their files by role (route, service, model, test…).
3. It reads those files, copies their structure and naming, and writes the change.
4. `dev-agent diff review` before reporting done.

## What the index knows

- Only paths and names of the repository files (it reads dependency manifests only to detect the stack). It never reads source contents, so it cannot leak them and is bounded (20,000 files, depth 8, common build and dependency directories skipped).
- Roles are heuristics from path segments and suffixes (`migrations/`, `*.service.*`, `tests/`…). A feature is a group of files sharing a name across at least two roles, or three or more files.
- Conventions (file naming, test suffix) are reported only when consistent enough; otherwise `unknown` or `mixed`.

## What it does not know

Code-level idioms: error handling style, naming inside files, architectural rules that are not visible in paths. The agent still reads the neighbor files, and you can add such rules to your own knowledge or instruction files.

## Overriding

`repo index --write` regenerates only files it generated (they carry a marker) and reports the rest as skipped, so a hand-written `architecture.md` is never overwritten; delete it to let the kit regenerate it. Files ignored by git are not indexed, and the configured `knowledgeDir` is excluded from the scan. `diff review` compares against the `baseBranch` from `.dev-agent/config.yml` (else the detected main branch, also via `origin/`) and warns when it cannot find it. Set `knowledgeDir` in `.dev-agent/config.yml` to change where they live.

## Limits

`repo similar` matches words to feature and path names; a query with no match falls back to the most complete feature or reports none. `diff review` makes only two things errors (edited shipped migrations, secrets in added lines); everything else is advice.
