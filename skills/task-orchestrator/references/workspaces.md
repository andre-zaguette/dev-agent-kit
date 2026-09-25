---
name: workspaces
description: Run one work item across several repositories that share a plain parent folder: the workspaces map, dependency order, one branch name per repository, version pins, the root ledger and the producer/consumer contract.
type: contract
---

# Workspaces

Use this when `.dev-agent/config.yml` has a `workspaces:` map. Without it, ignore this file.

    workspaces:
      models:  { path: models,  role: library }
      backend: { path: backend, role: backend, dependsOn: [models] }
      client:  { path: client,  role: frontend, dependsOn: [backend], baseBranch: develop }

The root is a plain folder, not a repository. Each workspace is its own repository. The ledger, the state and the contract live at the root and never land in a commit.

## Workflow

1. Read the map. `dev-agent workspaces` shows each workspace, its Git state and its stack.
2. Classify per workspace, then decide which ones the item touches. `dev-agent workspaces order --only <names> --with-deps` gives the order: dependencies first.
3. Use one branch name for the item in every touched repository (the normal pattern rendering). Create the branches with the safe procedure in `git-workflow.md`, one repository at a time. A refusal in one repository stops the run and is reported; never force.
4. Record in the ledger's `Workspaces` section one step per workspace, in dependency order, and in the state each workspace's base branch, base SHA, branch and status.
5. Before touching a dependent, run `dev-agent workspaces verify`. `ahead` (the dependent needs a version that is not released yet) and `behind` (the dependent pins an older version than the one that exists) are a pin to fix, never a finished step. `unknown` and `not-declared` need a human look.
6. After each step run `dev-agent diff review --workspace <name>`; at the end run `dev-agent diff review --workspace all`.
7. Resume with `dev-agent task status <KEY>`: it checks every recorded workspace in its own directory.

## Publishing

Never publish a package version. When a dependent needs a new version of a library workspace, stop and ask the user to publish it, then continue once the new version exists and the pin is bumped. For local testing before that, an editable install is fine as long as it is not committed.

## API boundaries

For an HTTP boundary between workspaces the contract names `producer` and `consumers` (workspace names). `dev-agent contract usage <KEY>` then scans each consumer without `--client`. In-process boundaries between packages are covered by the pins and each repository's own tests, not by a contract.

## Never

Create branches, publish or bump versions from the CLI; treat a plain folder inside another repository as a repository; put the ledger, state or contract inside a workspace repository.
