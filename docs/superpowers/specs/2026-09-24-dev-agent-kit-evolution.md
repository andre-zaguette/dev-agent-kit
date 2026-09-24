# Frontend Agent Kit -> Dev Agent Kit

## Implementation plan for v0.6 through v1.0

Repository: `https://github.com/andre-zaguette/frontend-agent-kit`

Current baseline: v0.5 plus the post-v0.5 fixes already merged to `main`.

This document defines how to evolve the existing Frontend Agent Kit into a provider-neutral engineering agent that can ingest work items from pluggable task sources, inspect repositories, prepare implementation plans, manage Git branches safely, execute frontend/backend/fullstack tasks, verify the result, and maintain a task ledger that can be resumed later.

The existing frontend behavior must remain working throughout the migration.

---

# 1. Target user workflow

The primary interface remains the coding host running in the terminal: Claude Code, Codex, or another compatible host.

The task source is intentionally abstract. The user should be able to plug in any source that can be adapted to the canonical `WorkItem` model, including MCP-backed systems, issue trackers, project-management tools, repository issues, internal ticketing systems, or a future custom source.

Examples:

```text
Analise a tarefa HEF-123
```

```text
Analise a tarefa PAY-34 usando a fonte company
```

```text
Continue HEF-123
```

Expected end-to-end behavior:

```text
User request
    |
    v
Task Source Resolver
    |
    +--> explicit source in request/config
    +--> identifier pattern
    +--> configured default source
    +--> controlled capability/probe resolution
    |
    v
TaskSourceAdapter
(MCP-backed or future adapter type)
    |
    v
Read work item + comments + links + attachments
    |
    v
Normalize into canonical WorkItem
    |
    v
Inspect repository and current architecture
    |
    v
Create/update task ledger
.dev-agent/tasks/<WORK_ITEM_KEY>.md
    |
    v
Classify task
frontend | backend | fullstack | investigation-only | infrastructure
    |
    +-----------------------+
    |                       |
    v                       v
Frontend                Backend
Figma / refs            API / DB / queue
    |                       |
    +-----------+-----------+
                |
                v
Prepare Git safely
fetch -> update base ff-only -> branch
                |
                v
Implement
                |
                v
Run static + runtime verification
                |
                v
Review final diff
                |
                v
Update task ledger with:
- what changed
- how to run
- how to test
- verification evidence
- remaining risks/blockers
```

The user should not need to manually repeat work-item details already available from the configured Task Source.

The orchestration layer must never depend on a specific task product, product-specific field name, or one MCP server's tool naming.

---

# 2. Current repository state that must be preserved

The current repository already has production-worthy foundations that must be reused instead of rebuilt:

```text
packages/cli
packages/evals
packages/mcp-server
skills/
integrations/claude
integrations/codex
AGENTS.md
CLAUDE.md
```

Existing frontend skills:

```text
accessibility
component-selection
figma-to-code
frontend-design
motion-design
responsive-design
visual-validation
```

Existing MCP capabilities:

```text
capture_screenshot
inspect_dom
compare_screenshots
run_responsive_suite
run_accessibility_audit
```

Existing infrastructure:

```text
- Claude Code adapter
- Codex adapter
- managed instruction blocks
- MCP installation
- trust checks
- skill manifest/synchronization
- path and symlink hardening
- benchmark harness
- deterministic graders
- Figma mock MCP
- isolated benchmark workspaces
- headless Claude/Codex execution
- timeout/process-group handling
```

Do not create a second installer, second benchmark framework, second skill synchronizer, or second host adapter layer for backend work.

---

# 3. Architectural principle

The system becomes:

```text
                         DEV AGENT KIT
                              |
              +---------------+---------------+
              |                               |
         SHARED CORE                    TASK ORCHESTRATOR
              |                               |
      engineering principles           Task Source Registry
      repository inspection            Task Source Resolver
      verification                     canonical WorkItem
      context efficiency               task ledger + Git prep
              |                               |
              +---------------+---------------+
                              |
                   +----------+----------+
                   |                     |
               FRONTEND               BACKEND
                   |                     |
               Figma/UI              API/DB/Queue
               Visual diff           Security
               Responsive            Integrations
               Accessibility         Observability
                   |                     |
                   +----------+----------+
                              |
                          FULLSTACK
                              |
                       API contract
                              |
                      integration/E2E
                              |
                    Claude / Codex / ...
```

Task-source boundary:

```text
External task system
        |
        v
TaskSourceAdapter
        |
        v
Canonical WorkItem
        |
        v
Everything else in Dev Agent Kit
```

Nothing after the `Canonical WorkItem` boundary should need to know which product, MCP implementation, or transport produced the task.

Core rule:

```text
The host may change.
The task source may change.
The engineering workflow must not.
```

Claude Code and Codex are executors, not the source of the agent's engineering knowledge.

---

# 4. Migration strategy

Do not immediately move all current frontend skills into a new nested directory.

The current CLI, manifest checks, evals, and benchmark logic already expect the canonical root `skills/` directory. Avoid a large structural migration while adding new functionality.

For v0.6-v0.9, keep all canonical skills as top-level directories under `skills/`:

```text
skills/
├── accessibility
├── component-selection
├── figma-to-code
├── frontend-design
├── motion-design
├── responsive-design
├── visual-validation
│
├── task-orchestrator
├── repository-investigation
├── engineering-architecture
├── verification
├── root-cause-analysis
├── surgical-diff
├── context-efficiency
├── repo-memory
│
├── backend-architecture
├── api-design
├── data-modeling
├── database-migrations
├── backend-testing
├── auth-security
├── external-integrations
├── async-jobs
├── observability
└── backend-performance
```

Later, after the installer understands domains explicitly, a separate migration may reorganize them physically.

Do not make that reorganization a prerequisite for backend support.

---

# 5. Release roadmap

## v0.5.1 - benchmark/runtime hardening

Fix the highest-value deferred reliability issues before expanding the benchmark matrix.

Priority:

```text
1. Bound stdout/stderr capture size in benchmark child processes.
2. Guarantee workspace cleanup if static-server startup fails.
3. Make benchmark temporary directories collision-safe under concurrent runs.
```

Also evaluate, but do not block the next version on all of them:

```text
- process signal handling beyond SIGINT
- Codex writable /tmp behavior
- Figma mock directory creation through malicious symlink edge case
- remaining low-severity nits
```

Run the current full 18-scenario real benchmark after these fixes:

```bash
npm run bench -- --host all
```

Store the report as the behavioral baseline before the shared-core refactor.

Acceptance criteria:

```text
[ ] all offline tests green
[ ] all 18 existing scenarios still valid
[ ] real benchmark report archived
[ ] no frontend regression introduced
```

---

# 6. v0.6 - Shared Engineering Core

Goal: add provider-neutral engineering behavior without changing existing frontend behavior.

## 6.1 New shared skills

Create:

```text
skills/engineering-architecture/SKILL.md
skills/repository-investigation/SKILL.md
skills/verification/SKILL.md
skills/root-cause-analysis/SKILL.md
skills/surgical-diff/SKILL.md
skills/context-efficiency/SKILL.md
skills/repo-memory/SKILL.md
```

These skills must not assume any specific frontend framework, backend framework, model host, or task source.

### engineering-architecture

Responsibilities:

```text
- inspect existing architecture before designing
- reuse local patterns before introducing new abstractions
- define boundaries and ownership
- model domain states explicitly
- identify concurrency and idempotency requirements
- minimize unnecessary layers
```

### repository-investigation

Responsibilities:

```text
- identify stack
- identify package manager
- identify tests/lint/typecheck commands
- identify project structure
- locate neighboring implementations
- locate existing components/services/models/schemas
- inspect relevant Git history when useful
- return a compact evidence-backed repository map
```

### verification

Generic verification model:

```text
frontend UI     -> render and interact
API             -> real HTTP request when practical
database        -> run migration/query
background job  -> enqueue and consume when practical
bug             -> reproduce before and after
```

Compilation alone is never runtime proof.

### root-cause-analysis

Required defect sequence:

```text
reproduce -> evidence -> root cause -> regression test -> fix -> verify
```

### surgical-diff

Before completion:

```text
requested scope
      ~=
actual diff
```

Flag unrelated renames, formatting churn, speculative abstractions, unrelated comments, and changes not required by the work item.

### context-efficiency

Implements token/context discipline inspired by compact-agent workflows:

```text
- load only task-relevant skills
- keep subagent results structured and compact
- never compress code/errors in a way that changes semantics
- avoid repeating repository facts already persisted in fresh repo memory
- do not load frontend references for backend tasks and vice versa
```

### repo-memory

Persist reusable repository knowledge locally:

```text
.dev-agent/knowledge/
├── repository.md
├── architecture.md
├── frontend.md
├── backend.md
└── commands.md
```

Every generated knowledge file must include the source commit SHA.

Example:

```yaml
sourceSha: abc1234
updatedAt: 2026-09-24T14:00:00Z
```

When HEAD changes, do not blindly trust stale memory. Revalidate relevant sections or update from the Git delta.

## 6.2 Adapt concepts, do not add competing orchestrators

Use selected ideas from existing public agent workflows:

```text
pstack-like:
- prove behavior
- root-cause fixes
- blast-radius thinking
- architecture before broad changes
- minimal changes

Karpathy-inspired:
- context audit
- surgical diff review
- evidence-gated refactoring
- repository wiki/memory

Caveman-inspired:
- concise agent-to-agent communication
- low-noise subagent reports
```

Do not install multiple frameworks that each attempt to own the entire workflow.

The Dev Agent Kit remains the single orchestrator.

## 6.3 Context audit command

Eventually expose:

```bash
dev-agent context audit
```

The audit should identify:

```text
- duplicated always-on instructions
- large CLAUDE.md / AGENTS.md blocks
- framework knowledge that should be lazy-loaded
- stale repository facts
- duplicated skill instructions
```

Report estimated removable/replayable instruction size where practical.

---

# 7. v0.7 - Pluggable Task Source Orchestrator

This is the main workflow layer.

Create the orchestration skill:

```text
skills/task-orchestrator/
├── SKILL.md
└── references/
    ├── work-item.md
    ├── task-source.md
    ├── source-resolution.md
    ├── generic-mcp.md
    ├── git-workflow.md
    └── task-ledger.md
```

Add deterministic source infrastructure under the shared core instead of encoding source logic inside prompts:

```text
packages/core/
└── src/
    └── task-sources/
        ├── types.ts
        ├── registry.ts
        ├── resolver.ts
        ├── normalizer.ts
        ├── generic-mcp.ts
        └── mapping.ts
```

The skill entrypoint stays compact. Adapter contracts, source resolution, mapping rules, and Git behavior belong in lazy-loaded references or deterministic code.

## 7.1 TaskSourceAdapter contract

Use one source-neutral contract:

```ts
interface TaskSourceAdapter {
  id: string;

  capabilities(): TaskSourceCapabilities;

  getWorkItem(identifier: string): Promise<WorkItem>;

  search?(query: string): Promise<WorkItemSummary[]>;
  getComments?(identifier: string): Promise<WorkItemComment[]>;
  getAttachments?(identifier: string): Promise<WorkItemAttachment[]>;
  getLinkedItems?(identifier: string): Promise<WorkItemLink[]>;
}

interface TaskSourceCapabilities {
  search: boolean;
  comments: boolean;
  attachments: boolean;
  links: boolean;
  write: boolean;
}
```

Capabilities are explicit because not every source supports the same operations.

Read capability and write capability must remain separate. Connecting a readable task source never implies authorization to mutate it.

## 7.2 Registry

Maintain a runtime registry:

```text
TaskSourceRegistry
├── register(adapter)
├── list()
├── get(id)
└── resolve(identifier, explicitSource?)
```

The orchestrator consumes the registry rather than importing concrete task products.

## 7.3 Source resolution priority

Resolve a work item using this order:

```text
1. explicit source from request
2. explicit source from project config for matching identifier
3. identifier pattern match
4. configured default source
5. controlled probe only when enabled and unambiguous
```

Never spray the same identifier across every configured external system by default.

If multiple sources match, stop and ask for source selection rather than guessing.

## 7.4 Generic MCP adapter

The preferred first integration mechanism is a declarative `generic-mcp` adapter so a new MCP-backed task source can be added without writing a TypeScript adapter.

Conceptual configuration:

```yaml
taskSources:
  company:
    adapter: generic-mcp
    server: company-tasks
    default: true

    identifiers:
      - '^HEF-\\d+$'
      - '^PAY-\\d+$'

    tools:
      get:
        name: get_issue
      search:
        name: search_issues
      comments:
        name: get_comments
      attachments:
        name: get_attachments
      links:
        name: get_links

    mapping:
      id: id
      key: key
      title: summary
      description: description
      status: status.name
      priority: priority.name
      labels: labels
```

Another source may return a completely different payload and only needs a different mapping:

```yaml
mapping:
  id: ticket_id
  key: reference
  title: subject
  description: body
  status: state
```

The rest of the Dev Agent Kit remains unchanged.

## 7.5 Native/custom adapters

If declarative mapping is insufficient, allow a custom adapter:

```text
integrations/task-sources/<source-id>/
```

A custom adapter may handle:

```text
- pagination
- unusual authentication flow
- non-MCP transport
- computed acceptance criteria
- custom attachment retrieval
- source-specific link semantics
```

It must still output the canonical `WorkItem` model.

## 7.6 Optional write extension

Reserve a separate writable capability for future features:

```ts
interface WritableTaskSourceAdapter extends TaskSourceAdapter {
  addComment(identifier: string, text: string): Promise<void>;
  updateStatus?(identifier: string, status: string): Promise<void>;
  addLink?(identifier: string, link: string): Promise<void>;
}
```

Do not use write operations unless the user or project policy explicitly authorizes them.

---

# 8. WorkItem normalization

The rest of the system must not depend directly on source-specific response shapes.

Normalize all source data into one conceptual structure:

```ts
interface WorkItem {
  source: string;
  id: string;
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  comments: WorkItemComment[];
  attachments: WorkItemAttachment[];
  links: WorkItemLink[];
  status?: string;
  type?: string;
  priority?: string;
  labels?: string[];
  assignee?: {
    id?: string;
    name?: string;
  };
  rawUrl?: string;
  metadata?: Record<string, unknown>;
}

interface WorkItemComment {
  id?: string;
  author?: string;
  body: string;
  createdAt?: string;
}

interface WorkItemAttachment {
  id: string;
  name: string;
  mimeType?: string;
  url?: string;
  localPath?: string;
}

interface WorkItemLink {
  type:
    | 'parent'
    | 'child'
    | 'blocks'
    | 'blocked-by'
    | 'relates-to'
    | 'duplicate'
    | 'other';
  key?: string;
  url?: string;
  title?: string;
}
```

Task-source workflow:

```text
user input
    |
    v
Task Source Resolver
    |
    v
selected TaskSourceAdapter
    |
    v
get primary work item
    |
    +--> comments if capability exists
    +--> attachment metadata if capability exists
    +--> linked work items when relevant
    |
    v
normalize to canonical WorkItem
```

Acceptance criteria normalization:

```text
source has dedicated field
    -> normalize it

source embeds criteria in description
    -> extract structured criteria conservatively

criteria cannot be determined reliably
    -> [] and record that explicit criteria were unavailable
```

If the selected source is disconnected, unavailable, or authentication fails:

```text
- do not invent work-item content
- clearly mark the source as unavailable
- request source connection/authentication or pasted task content
- preserve any repository analysis that can still be performed safely
```

MCP tool names are source configuration, not orchestration behavior. The task-orchestrator skill should describe capabilities and consume normalized data rather than hard-code external tool names.

---

# 9. Task ledger

Every analyzed work item gets a persistent local ledger.

Default location:

```text
.dev-agent/tasks/<WORK_ITEM_KEY>.md
.dev-agent/state/<WORK_ITEM_KEY>.json
```

Example:

```text
.dev-agent/tasks/HEF-123.md
.dev-agent/state/HEF-123.json
```

The Markdown file is human-readable.

The JSON file is machine-resumable state.

## 9.1 Markdown structure

```markdown
# HEF-123 - <title>

## Source
- Source ID: company
- Work item: HEF-123
- URL: ...
- Last synced: ...

## Requirement
Normalized description.

## Acceptance criteria
- ...

## Relevant comments / decisions
- ...

## Classification
Frontend | Backend | Fullstack | Investigation | Infrastructure

## Repository analysis
- stack
- relevant modules
- existing patterns
- affected files

## Visual source
Figma MCP | screenshot folder | screenshots | not applicable | blocked

## Implementation plan
1. ...
2. ...

## Git
- base branch
- base SHA
- working branch

## Implementation log
Short factual entries only.

## Verification
Commands and results.

## How to run locally
Exact commands.

## How to test this work item manually
Exact scenario and expected result.

## Risks / known differences
- ...

## Final status
planned | blocked | implementing | verifying | done
```

## 9.2 Machine state

Example:

```json
{
  "workItemKey": "HEF-123",
  "source": "company",
  "classification": "frontend",
  "phase": "implementation",
  "baseBranch": "main",
  "baseSha": "abc1234",
  "workingBranch": "feat/hef-123-meeting-card",
  "visualSource": "figma-mcp",
  "skills": ["figma-to-code", "visual-validation"],
  "updatedAt": "2026-09-24T14:00:00Z"
}
```

The state file must never contain secrets, authentication material, or MCP tokens.

## 9.3 Source identity

Persist the logical source ID, not product-specific implementation details.

Good:

```json
{ "source": "company" }
```

Avoid coupling state to one transport/tool implementation unless required for resumption.

---

# 10. Resume workflow

Input:

```text
Continue HEF-123
```

Workflow:

```text
read .dev-agent/state/HEF-123.json
        |
        v
read HEF-123.md
        |
        v
validate current Git branch + HEAD
        |
        v
resolve saved Task Source
        |
        v
refresh work item only if needed
        |
        v
revalidate stale repository knowledge
        |
        v
continue from recorded phase
```

If the configured source no longer exists, preserve the task ledger and stop only when fresh external task data is required.

If the current repository state no longer matches the saved state, stop and reconcile instead of assuming the ledger is current.

---

# 11. Task classification

Classify after reading both the normalized work item and the repository.

Possible classes:

```text
frontend
backend
fullstack
investigation-only
infrastructure
```

Examples:

```text
Vue component + Figma                -> frontend
Django endpoint                      -> backend
React form + new REST endpoint       -> fullstack
"Why is X happening?"               -> investigation-only
Docker deployment config             -> infrastructure
```

Classification determines which skills/references are loaded.

Do not load all domain knowledge for every work item.

---

# 12. Git preparation workflow

Git changes must be deterministic and safe.

Priority for base branch discovery:

```text
1. .dev-agent/config.yml
2. repository instructions
3. origin/HEAD
4. main if it exists
5. master if it exists
```

Before changing branches:

```text
1. git status --porcelain
2. if dirty: stop before automatic branch manipulation
3. git fetch --prune origin
4. determine base branch
5. verify base relationship
6. update base with fast-forward only
7. create task branch
8. record base SHA and task branch in ledger
```

Never automatically:

```text
- git reset --hard
- discard local changes
- force-push
- rebase user work without explicit instruction
- auto-stash and forget the stash
```

Preferred base update:

```text
git fetch --prune origin
git switch <base>
git merge --ff-only origin/<base>
```

If the local base diverged, stop and report the divergence.

Do not hide it with reset/rebase.

---

# 13. Branch naming

The repository-specific instructed pattern always wins.

Priority:

```text
1. .dev-agent/config.yml explicit pattern
2. AGENTS.md / CLAUDE.md / CONTRIBUTING.md instructions
3. clearly consistent existing remote branch pattern
4. fallback pattern
```

Fallback:

```text
{type}/{keyLower}-{slug}
```

Examples:

```text
feat/hef-123-biometric-report
fix/pay-34-duplicate-payment
chore/ops-9-worker-config
```

If repository history is inconsistent and no pattern is explicitly configured, ask once instead of inventing a convention.

---

# 14. Project config

Add a new orchestration config rather than immediately replacing `.frontend-agent/config.yml`.

```text
.dev-agent/config.yml
```

Example:

```yaml
baseBranch: main
branchPattern: "{type}/{keyLower}-{slug}"

taskDocsDir: .dev-agent/tasks
stateDir: .dev-agent/state
knowledgeDir: .dev-agent/knowledge

contextMode: balanced

production:
  readOnly: true

git:
  updateStrategy: ff-only
  requireCleanTree: true

taskSources:
  company:
    adapter: generic-mcp
    server: company-tasks
    default: true
    identifiers:
      - '^HEF-\\d+$'
      - '^PAY-\\d+$'
    tools:
      get:
        name: get_issue
      comments:
        name: get_comments
      attachments:
        name: get_attachments
    mapping:
      id: id
      key: key
      title: summary
      description: description
      status: status.name
```

Rules:

```text
- source IDs are user/project-defined aliases such as company, product, personal
- no source product is privileged in the core
- multiple sources may coexist
- only one source may be default
- identifier regexes are optional but preferred for deterministic resolution
- ambiguous resolution must not guess
```

Keep `.frontend-agent/config.yml` responsible for visual validation during the transition.

A later v1.x migration may unify configuration if doing so provides real value.

---

# 15. Frontend task path

If classification is frontend or fullstack:

```text
inspect repository
    |
    v
detect framework/design system/components
    |
    v
find visual source
    |
    +--> Figma link + connected MCP
    |       -> use Figma MCP
    |
    +--> Figma unavailable
            -> look for supplied screenshots/reference folder
            -> otherwise request screenshots or reference-folder path
```

## 15.1 Figma source rules

If Figma MCP is connected:

```text
- fetch design context
- fetch screenshot/reference
- inspect variables/tokens/assets
- map Figma to existing components
```

Figma remains the visual source of truth.

## 15.2 Figma unavailable

If the task requires visual implementation but Figma cannot be accessed:

```text
- continue repository analysis
- prepare task ledger and implementation plan
- request screenshots and/or a local reference folder
- do not invent visual details
- do not mark the UI implementation complete without a usable visual source
```

Record:

```text
Visual source: screenshots
Visual source: local-folder
Visual source: blocked
```

## 15.3 Existing visual verification

Reuse the current MCP:

```text
capture_screenshot
inspect_dom
compare_screenshots
run_responsive_suite
run_accessibility_audit
```

Do not create a second visual-validation server.

---

# 16. v0.8 - Backend domain

Add backend behavior on top of the shared core.

Create:

```text
skills/backend-architecture/
skills/api-design/
skills/data-modeling/
skills/database-migrations/
skills/backend-testing/
skills/auth-security/
skills/external-integrations/
skills/async-jobs/
skills/observability/
skills/backend-performance/
```

Framework details should be lazy-loaded references, not always-on instructions.

Recommended references:

```text
python
django
drf
fastapi
node-typescript
nestjs
postgresql
redis
rabbitmq
celery
docker
openapi
security
```

Initial supported stack focus:

```text
Python:
- Django
- Django REST Framework
- FastAPI
- pytest
- ruff
- mypy
- Celery

Node/TypeScript:
- NestJS
- existing Express projects
- Jest/Vitest
- ESLint
- tsc

Infrastructure/data:
- PostgreSQL
- Redis
- RabbitMQ
- Docker/Compose
- OpenAPI
```

Detect the repository first. Never force these technologies into projects that do not use them.

---

# 17. Backend execution workflow

For backend work items:

```text
work item
  |
  v
repository investigation
  |
  v
existing architecture + neighboring feature
  |
  v
data/domain model
  |
  v
API/job/integration contract
  |
  v
transaction/concurrency/security analysis
  |
  v
implementation
  |
  v
static checks
  |
  v
tests
  |
  v
runtime smoke test
  |
  v
surgical diff review
```

Before coding, consider when applicable:

```text
- transaction boundary
- concurrent writers
- idempotency
- authorization
- unique constraints
- indexes
- retry policy
- duplicate message processing
- external API timeout
- rollback/forward-fix migration strategy
```

---

# 18. Backend API workflow

For API work:

```text
1. inspect neighboring endpoints
2. identify request/response conventions
3. identify authentication/authorization pattern
4. define request schema
5. define response schema
6. define error contract
7. determine transaction requirements
8. determine idempotency/concurrency requirements
9. implement domain behavior
10. expose API boundary
11. update OpenAPI when applicable
12. add tests
13. start application
14. make a real request when practical
15. validate database side effects
```

Definition of Done:

```text
[ ] request validated
[ ] response contract verified
[ ] status codes correct
[ ] authentication checked
[ ] resource authorization checked
[ ] transaction/concurrency considered
[ ] error path tested
[ ] runtime request verified
```

---

# 19. Database and migration workflow

Check:

```text
- primary/foreign keys
- unique constraints
- nullability
- indexes
- data volume
- backfill requirements
- lock risk
- transaction duration
- rollback or forward-fix strategy
```

For PostgreSQL, use repository tooling and optionally:

```text
psql
EXPLAIN
EXPLAIN ANALYZE
```

Do not add indexes blindly.

Every new index should map to an observed or required query pattern.

Production remains read-only unless explicitly authorized.

---

# 20. Async jobs and queues

For RabbitMQ/Celery/queue work, consider:

```text
message schema
producer
consumer
ack strategy
retry strategy
max retries
dead-letter behavior
idempotency
ordering
observability
poison messages
```

Assume at-least-once delivery unless the actual infrastructure guarantees otherwise.

Consumers must be safe against duplicate processing when the domain requires it.

---

# 21. External integrations

Every external integration should evaluate:

```text
timeout
retryable failures
non-retryable failures
429/rate limits
5xx behavior
auth refresh
schema drift
idempotency
partial failure
observability
```

Vendor response types should be normalized at the integration boundary rather than leaked across the domain layer.

---

# 22. Security

Backend review should check, as applicable:

```text
BOLA / IDOR
broken authorization
mass assignment
SQL injection
command injection
unsafe deserialization
SSRF
secret leakage
unsafe upload
rate limiting
CORS
CSRF
sensitive logging
```

Never write credentials, access tokens, refresh tokens, private keys, or secrets into task ledgers.

---

# 23. v0.9 - Fullstack orchestration

A fullstack work item gets one orchestrator and two domain execution paths.

```text
WorkItem
   |
   v
shared investigation
   |
   v
explicit API contract
   |
   +----------------------+
   |                      |
   v                      v
backend                frontend
API/DB/tests           Figma/UI/tests
   |                      |
   +----------+-----------+
              |
              v
        integration verify
              |
              v
        final task ledger
```

Before frontend/backend implementation diverges, persist one contract:

```text
.dev-agent/tasks/<WORK_ITEM_KEY>.contract.json
```

Example:

```json
{
  "method": "POST",
  "path": "/api/users",
  "request": {
    "email": "string",
    "name": "string"
  },
  "response": {
    "id": "uuid",
    "email": "string",
    "name": "string"
  },
  "errors": {
    "400": ["INVALID_INPUT"],
    "409": ["EMAIL_ALREADY_EXISTS"]
  }
}
```

Both domains implement against this same contract.

---

# 24. Context and token economy

Token optimization must improve efficiency without lowering correctness.

Core rule:

```text
Use the minimum context required to make the correct decision.
```

Not:

```text
Use the fewest tokens possible.
```

## 24.1 Progressive loading

Example backend API work item:

Load:

```text
- task-orchestrator
- repository-investigation
- verification
- api-design
- detected framework reference
```

Do not load:

```text
- Figma
- motion design
- accessibility
- RabbitMQ guide if no queue is involved
- all framework references
```

## 24.2 Compact subagent contracts

If the host supports subagents, use optional roles:

```text
investigator
architect
implementer
reviewer
verifier
visual-reviewer
security-reviewer
```

Subagent outputs should be structured and concise.

Good investigator output:

```text
FILES
- src/auth/service.ts: token validation
- src/auth/middleware.ts: caller
- tests/auth.test.ts: existing behavior

PATTERN
JWT parsing happens in AuthService.

RISK
Refresh token path uses a separate validator.

NEXT
Inspect refresh-token behavior before editing.
```

Avoid long narrative restatements of facts already visible to the parent agent.

## 24.3 Repository memory

Use `.dev-agent/knowledge` to avoid rediscovering stable facts on every work item.

Cache only useful stable information:

```text
architecture map
known test commands
package manager
common folders
branch conventions
frontend design system location
backend service boundaries
```

Never cache secrets.

Always associate memory with a source commit SHA.

---

# 25. CLI evolution

Do not break current commands while generalizing.

During v0.6-v0.9 retain:

```bash
frontend-agent install
frontend-agent verify
```

Add aliases/new commands incrementally:

```bash
dev-agent install
dev-agent verify
dev-agent inspect
dev-agent context audit
dev-agent repo index
dev-agent diff review
```

Task-source inspection helpers:

```bash
dev-agent sources
dev-agent sources verify
dev-agent task resolve HEF-123
dev-agent task status HEF-123
dev-agent task show HEF-123
```

Example behavior:

```text
dev-agent sources

company       generic-mcp    default
personal      generic-mcp
```

The natural-language task workflow still runs through Claude Code/Codex in the terminal when those hosts own the connected MCP tools and reasoning loop.

The deterministic CLI may resolve configuration, validate mappings, inspect Git/project state, and maintain local ledgers without becoming a second LLM orchestrator.

Do not make the deterministic CLI responsible for the full reasoning loop unless a later version explicitly introduces a standalone harness.

At v1.0 either:

```text
A. keep frontend-agent as a compatibility alias to dev-agent
or
B. deprecate frontend-agent over a documented transition window
```

Do not silently remove it.

---

# 26. Deterministic project inspector

Add a reusable project inspector in code rather than reimplementing stack detection inside multiple skills.

Suggested package/module:

```text
packages/core/
├── src/project-profile.ts
├── src/git.ts
├── src/task-state.ts
├── src/context.ts
└── tests/
```

Conceptual project profile:

```ts
interface ProjectProfile {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
  testCommands: string[];
  lintCommands: string[];
  typecheckCommands: string[];
  database?: string;
  migrationTool?: string;
  queue?: string;
  docker: boolean;
  baseBranch?: string;
}
```

Detect from repository evidence such as:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock
pyproject.toml
requirements.txt
manage.py
nest-cli.json
docker-compose.yml
compose.yml
alembic.ini
prisma/
migrations/
Makefile
Taskfile.yml
```

Do not guess commands when repository scripts are available.

---

# 27. Instruction files

Current `CLAUDE.md` and `AGENTS.md` are frontend-specific.

Generalize them gradually.

Keep always-on instructions short.

Target shape:

```text
1. use installed Dev Agent Kit skills
2. route external work items through task-orchestrator
3. resolve them through configured Task Sources
4. inspect before editing
5. verify real behavior
6. load domain skills only when relevant
```

Do not put concrete Task Source product instructions in always-on files.

Source-specific knowledge belongs in adapter configuration or lazy-loaded references.

Move detailed frontend/backend workflows into skills/references rather than growing `CLAUDE.md` and `AGENTS.md` indefinitely.

This is critical for context economy.

---

# 28. Evals expansion

Reuse `packages/evals`.

Do not create a second backend benchmark harness.

## 28.1 Generic Task Source mock MCPs

Add at least two deterministic mock Task Sources with deliberately different schemas so the benchmark proves that normalization is source-agnostic.

Example source A payload:

```json
{
  "id": "123",
  "key": "APP-123",
  "summary": "Add account form",
  "description": "...",
  "status": { "name": "Open" }
}
```

Example source B payload:

```json
{
  "ticket_id": "123",
  "reference": "APP-123",
  "subject": "Add account form",
  "body": "...",
  "state": "Open"
}
```

Both must normalize to the same `WorkItem` contract.

Mocks should expose enough behavior to test:

```text
get work item
comments
attachment metadata
linked work items
missing/unavailable work item
authentication/unavailable source failure
```

The benchmark should test behavior and normalization, not one external product's production API.

## 28.2 New scenario categories

Add task-orchestrator scenarios:

```text
orchestrator-source-a-frontend-figma
orchestrator-source-b-frontend-no-figma
orchestrator-source-a-backend
orchestrator-source-b-backend
orchestrator-explicit-source
orchestrator-default-source
orchestrator-identifier-resolution
orchestrator-ambiguous-source
orchestrator-fullstack
orchestrator-dirty-tree
orchestrator-diverged-base
orchestrator-missing-work-item
orchestrator-unavailable-source
orchestrator-resume-task
orchestrator-branch-pattern
orchestrator-analysis-only
```

Backend scenarios:

```text
backend-django-api
backend-drf-permission
backend-fastapi-api
backend-nest-api
backend-postgres-migration
backend-rabbitmq-consumer
backend-celery-task
backend-root-cause-bugfix
backend-external-integration
```

Fullstack scenarios:

```text
fullstack-api-contract
fullstack-form-plus-api
fullstack-validation-error-contract
```

## 28.3 Add useful deterministic assertions

Extend grader types where needed:

```text
command_succeeded
git_branch_matches
git_base_sha_matches
task_doc_has_section
json_matches
http_response_matches
skill_not_read
task_source_resolved
work_item_normalized
source_not_probed
```

Do not rely on model prose to determine whether Git safety or source-resolution requirements passed.

## 28.4 Source fixtures

Create source fixtures that test:

```text
explicit source selection
default source selection
identifier pattern matching
ambiguous source refusal
unsupported capability fallback
different external schemas -> same WorkItem
source unavailable/auth failure
```

## 28.5 Git fixtures

Create temporary Git fixtures with a local bare remote so tests can verify:

```text
fetch
ff-only update
branch creation
dirty tree refusal
diverged base refusal
resume behavior
```

These should run offline and free.

---

# 29. Task document update policy

The task ledger is updated at defined checkpoints instead of after every tiny command.

Checkpoints:

```text
1. after work item ingestion
2. after repository investigation
3. after Git preparation
4. after implementation phase
5. after verification
6. final status
```

This avoids noisy token-heavy logging while keeping reliable recovery state.

Use concise factual entries.

---

# 30. Analysis-only behavior

"Analise a tarefa X" may mean analysis only unless the project's configured workflow explicitly says analysis should continue automatically into implementation.

Support two modes:

```text
analysis
execute
```

Recommended semantics:

```text
"Analise a tarefa X"
-> ingest + inspect + task doc + plan
-> no code modification unless project/user convention explicitly authorizes auto-execution

"Execute a tarefa X"
-> full workflow including Git branch and implementation
```

If the user's established convention is that "analise" means analyze then execute, allow configuration:

```yaml
taskMode:
  analyzeCommand: execute-after-plan
```

Never let benchmark prompts ambiguously modify files when the scenario is meant to be read-only.

---

# 31. Local run/test documentation

Every completed implementation must update the task ledger with exact commands derived from the real repository.

Example:

```markdown
## How to run locally

```bash
npm install
npm run dev
```

## Automated verification

```bash
npm run typecheck
npm test
```

## Manual verification

1. Open `/meetings`.
2. Select a meeting with biometric attendance.
3. Confirm ...
4. Expected result: ...
```

Do not write generic commands that were not verified against the repository.

---

# 32. Definition of Done - task orchestrator

```text
[ ] Task Source resolved deterministically
[ ] work item read from selected source
[ ] relevant comments considered when capability exists
[ ] attachments/links considered when relevant and supported
[ ] acceptance criteria normalized without invention
[ ] canonical WorkItem persisted
[ ] repository inspected
[ ] task classified
[ ] task ledger created/updated
[ ] Git base branch identified
[ ] base updated safely with ff-only semantics
[ ] task branch follows repository convention
[ ] relevant domain skills loaded
[ ] implementation matches work-item scope
[ ] tests/typecheck/lint run when configured
[ ] runtime behavior verified when practical
[ ] frontend visual validation run when applicable
[ ] final diff reviewed for unrelated changes
[ ] local run instructions documented
[ ] manual test instructions documented
[ ] blockers/known differences recorded
```

Additional source requirements:

```text
[ ] no source-specific response shape leaked past normalization boundary
[ ] ambiguous source resolution never guesses
[ ] unavailable source never causes fabricated task content
[ ] source write capability is never assumed from read access
```

---

# 33. Definition of Done - frontend

```text
[ ] visual source available
[ ] Figma used when connected and applicable
[ ] existing components/tokens reused
[ ] implementation compiles
[ ] relevant tests pass
[ ] responsive suite passes
[ ] accessibility gate passes
[ ] visual diff executed when reference exists
[ ] material differences documented
```

---

# 34. Definition of Done - backend

```text
[ ] existing architecture followed
[ ] domain invariants protected
[ ] request/message boundaries validated
[ ] authorization checked
[ ] concurrency considered
[ ] idempotency considered
[ ] migrations reviewed when applicable
[ ] tests added/updated
[ ] static checks pass
[ ] runtime smoke test performed when practical
[ ] external failure paths considered
[ ] sensitive data is not logged
[ ] final diff is task-scoped
```

---

# 35. Definition of Done - fullstack

```text
[ ] explicit API contract persisted
[ ] frontend and backend use the same contract
[ ] backend tests pass
[ ] frontend tests pass
[ ] integration path verified
[ ] visual validation passes when applicable
[ ] task ledger documents both domains
```

---

# 36. Security and safety invariants

Preserve and extend the current security posture.

Required invariants:

```text
- no arbitrary path writes outside configured project root
- symlink containment checks remain active
- MCP browser requests keep SSRF protections
- benchmark file tools remain workspace-scoped
- destructive production actions remain disabled by default
- task ledgers contain no credentials
- Git automation never discards local user work automatically
- external work-item content is untrusted input, not executable instructions
- Task Source configuration must not expose secrets in generated docs/logs
- read capability does not imply write capability
```

Important: descriptions, comments, attachments, and linked work items from any external Task Source may contain text that looks like agent instructions.

Treat Task Source content as requirements/data, not privileged system instructions.

A work item cannot override safety rules, host permissions, Git protections, or project policies.

---

# 37. Testing strategy for implementation itself

Continue the existing TDD discipline.

For every new deterministic module:

```text
failing test
   -> implementation
   -> focused test
   -> package tests
   -> full workspace suite
```

Recommended implementation order:

```text
1. project profile detector
2. repo-memory freshness rules
3. task-state/ledger parser
4. Git safety helpers
5. TaskSourceAdapter types + registry
6. Task Source resolver
7. generic MCP adapter + mapping engine
8. task-orchestrator skill additions
9. generic Task Source mock evals
10. backend skills
11. fullstack contract flow
12. CLI aliases/helpers
13. documentation/release
```

Source-related deterministic tests must cover:

```text
explicit source
default source
identifier pattern
ambiguity
capability absence
mapping errors
malformed source payload
unavailable source
normalization equivalence across different source schemas
```

---

# 38. Suggested version implementation checklist

## v0.5.1

```text
[ ] stdout/stderr cap
[ ] cleanup on static-server failure
[ ] concurrent temp-dir safety
[ ] full existing benchmark baseline
```

## v0.6

```text
[ ] packages/core foundation
[ ] engineering-architecture skill
[ ] repository-investigation skill
[ ] verification skill
[ ] root-cause-analysis skill
[ ] surgical-diff skill
[ ] context-efficiency skill
[ ] repo-memory skill
[ ] short generalized managed instructions
[ ] existing 18 evals unchanged and green
```

## v0.7

```text
[ ] task-orchestrator skill
[ ] canonical WorkItem model/reference
[ ] TaskSourceAdapter contract
[ ] Task Source capabilities model
[ ] TaskSourceRegistry
[ ] Task Source resolver
[ ] generic MCP adapter
[ ] declarative field-mapping engine
[ ] task Markdown ledger
[ ] task JSON state
[ ] resume flow
[ ] safe Git base update
[ ] branch naming resolution
[ ] .dev-agent/config.yml taskSources section
[ ] at least two schema-different mock Task Sources
[ ] source resolution/ambiguity evals
[ ] Git fixture evals
```

## v0.8

```text
[ ] backend architecture skill
[ ] API design
[ ] data modeling
[ ] migrations
[ ] backend testing
[ ] auth/security
[ ] integrations
[ ] jobs/queues
[ ] observability
[ ] performance
[ ] Django/DRF references
[ ] FastAPI references
[ ] Node/Nest references
[ ] PostgreSQL/Redis/RabbitMQ/Celery references
[ ] backend eval suite
```

## v0.9

```text
[ ] fullstack classification
[ ] API contract artifact
[ ] frontend/backend contract handoff
[ ] integration verifier
[ ] fullstack eval scenarios
[ ] dev-agent CLI alias
[ ] dev-agent sources / sources verify
```

## v1.0

```text
[ ] package naming/compatibility decision
[ ] installable package
[ ] complete README
[ ] Task Source adapter authoring guide
[ ] generic MCP mapping documentation
[ ] migration guide from frontend-agent
[ ] Claude real benchmark
[ ] Codex real benchmark
[ ] release notes
[ ] versioned GitHub release
```

---

# 39. Example final workflow - frontend work item

Input:

```text
Analise e execute HEF-123
```

Expected behavior:

```text
1. Resolve HEF-123 to the configured Task Source.
2. Read the canonical work item through the selected adapter.
3. Read relevant comments/attachments/links when supported.
4. Normalize acceptance criteria.
5. Inspect repository.
6. Create .dev-agent/tasks/HEF-123.md.
7. Classify as frontend.
8. Detect Figma URL or another visual reference.
9. Use Figma MCP if connected.
10. If unavailable, request screenshots/reference folder before visual implementation.
11. Ensure clean working tree.
12. Fetch origin.
13. Fast-forward configured base branch only.
14. Create repository-compliant task branch.
15. Implement using existing frontend skills.
16. Run tests/typecheck/lint.
17. Start application.
18. Run screenshot/DOM/visual/responsive/a11y validation.
19. Review final diff for unrelated changes.
20. Update HEF-123.md with exact local run/test instructions.
21. Mark final state done or blocked with evidence.
```

---

# 40. Example final workflow - backend work item

Input:

```text
Analise e execute PAY-34 usando a fonte company
```

Expected behavior:

```text
1. Select the explicit Task Source `company`.
2. Read PAY-34 through its TaskSourceAdapter.
3. Normalize requirement and acceptance criteria.
4. Inspect repository and detect backend stack.
5. Create task ledger.
6. Classify backend.
7. Inspect neighboring API/service/model/tests.
8. Identify transaction/concurrency/security implications.
9. Prepare Git safely.
10. Implement minimal task-scoped change.
11. Run formatter/lint/typecheck/tests when configured.
12. Start service when practical.
13. Exercise the real API/job behavior.
14. Review final diff.
15. Update local run/test instructions.
16. Record known risks and final evidence.
```

---

# 41. Example final workflow - fullstack work item

Input:

```text
Execute APP-88
```

Expected behavior:

```text
1. Resolve APP-88 to one configured Task Source.
2. Normalize the external payload into WorkItem.
3. Inspect frontend + backend areas.
4. Classify fullstack.
5. Persist explicit API contract.
6. Prepare Git branch.
7. Implement backend contract.
8. Implement frontend against the same contract.
9. Run domain-specific test suites.
10. Run runtime integration.
11. Run frontend visual validation.
12. Review combined diff.
13. Update APP-88.md with full local setup/test instructions.
```

---

# 42. Documentation changes

Update README incrementally as versions land.

Add docs:

```text
docs/task-orchestrator.md
docs/backend-agent.md
docs/context-efficiency.md
docs/fullstack-workflow.md
docs/migration-to-dev-agent.md
```

Keep the existing historical frontend design spec intact.

Create a new design spec rather than rewriting history:

```text
docs/superpowers/specs/2026-09-24-dev-agent-kit-evolution.md
```

This `doc.md` can serve as the starting content for that spec.

---

# 43. Compatibility rules

Until v1.0:

```text
- current frontend-agent install/verify commands keep working
- current seven frontend skills keep their names
- current frontend MCP tool names keep working
- current .frontend-agent/config.yml keeps working
- Claude and Codex adapters remain thin
- existing eval scenarios remain supported
```

New functionality is additive first.

Breaking renames come only with an explicit migration plan.

---

# 44. Final architecture after v1.0

```text
                         DEV AGENT KIT
                              |
        +---------------------+----------------------+
        |                     |                      |
   TASK INTAKE           SHARED CORE            EFFICIENCY
        |                     |                      |
 Task Sources            architecture           repo memory
 Registry/Resolver       verification           context audit
 Canonical WorkItem      root cause             compact reports
 task ledger             surgical diff          lazy references
 Git preparation             |                      |
        |                     |                      |
        +---------------------+----------------------+
                              |
                 +------------+------------+
                 |                         |
             FRONTEND                   BACKEND
                 |                         |
             Figma/UI                  API/DB/Queue
             visual diff               integrations
             responsive                security
             accessibility             observability
                 |                         |
                 +------------+------------+
                              |
                          FULLSTACK
                              |
                       shared contract
                              |
                      integration proof
                              |
                 +------------+------------+
                 |                         |
             Claude Code                 Codex
                 |                         |
                 +------------+------------+
                              |
                            VS Code
                           + terminal
```

Task-source plug-in boundary:

```text
Source A ----\
Source B -----+--> TaskSourceAdapter --> Canonical WorkItem --> Task Orchestrator
Source N ----/
```

The final operating principle is:

```text
UNDERSTAND
   -> INVESTIGATE
   -> DOCUMENT
   -> PREPARE
   -> IMPLEMENT
   -> VERIFY
   -> REVIEW
   -> DOCUMENT AGAIN
```

Sources of truth:

```text
Task Source
-> requirement truth

repository
-> implementation truth

Figma / screenshots
-> visual truth

tests + runtime evidence
-> completion truth
```

Final invariants:

```text
The model host may change.
The task source may change.
The transport may change.
The canonical WorkItem and engineering workflow stay stable.
```
