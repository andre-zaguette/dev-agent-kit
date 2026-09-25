import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { evalsLayout, loadScenarios } from '../src/load.ts';
import { createWorkspace, removeWorkspace } from '../src/workspace.ts';
import { findKitRoot } from '../../cli/src/util.ts';
import { grade } from '../src/grade.ts';
import type { RunRecord } from '../src/types.ts';

const kitRoot = findKitRoot();
const layout = evalsLayout(join(kitRoot, 'evals'));

test('the catalog loads: 7 base, 8 stack, 3 profile, 15 backend, 3 fullstack', () => {
  const scenarios = loadScenarios(layout);
  const count = (c: string) => scenarios.filter((s) => s.category === c).length;
  assert.deepEqual([count('base'), count('stack'), count('profile'), count('backend'), count('fullstack')], [7, 8, 3, 15, 3]);
});

test('every stack scenario maps to a figma-to-code reference and asserts it was read', () => {
  const refs = readdirSync(join(kitRoot, 'skills', 'figma-to-code', 'references')).map((f) => f.replace(/\.md$/, ''));
  const stacks = loadScenarios(layout).filter((s) => s.category === 'stack');
  assert.deepEqual(stacks.map((s) => s.id.replace(/^stack-/, '')).sort(), refs.sort());
  for (const s of stacks) {
    const stack = s.id.replace(/^stack-/, '');
    assert.ok(s.expected.some((a) => a.type === 'tool_called' && a.tool === `reference/${stack}`), s.id);
  }
});

test('the three profile scenarios cover each validationProfile and demand an explicit verdict line', () => {
  const profiles = loadScenarios(layout).filter((s) => s.category === 'profile');
  assert.deepEqual(profiles.map((s) => s.profile).sort(), ['pixel-perfect', 'relaxed', 'standard']);
  for (const s of profiles) assert.match(s.prompt, /VEREDITO: PASS/);
});

test('every fixture copies cleanly (no symlinks) and every prompt that needs the app uses {{baseUrl}}', () => {
  const scenarios = loadScenarios(layout);
  for (const fixture of new Set(scenarios.map((s) => s.fixture))) {
    const ws = createWorkspace(join(layout.fixturesDir, fixture));
    removeWorkspace(ws);
  }
  // Visual scenarios serve the workspace; stack scenarios and backend scenarios (no served app) do not.
  for (const s of scenarios.filter((s) => s.category === 'base' || s.category === 'profile')) assert.match(s.prompt, /\{\{baseUrl\}\}/, s.id);
});

test('every "do not change files" scenario also forbids a shell edit, not just Edit/Write/file_change', () => {
  const validationScenarios = loadScenarios(layout).filter((s) => s.forbidden.some((a) => a.type === 'tool_called' && a.tool === 'builtin/Edit'));
  assert.ok(validationScenarios.length >= 4, 'expected the 4 base-visual-divergence/profile-* scenarios');
  for (const s of validationScenarios) {
    assert.ok(
      s.forbidden.some((a) => a.type === 'tool_called' && a.tool === 'builtin/shell' && a.args?.command),
      `${s.id}: missing a forbidden builtin/shell write check (a Codex "sed -i" edit would slip past Edit/Write/file_change)`
    );
  }
});

test('the shell-write forbidden check actually catches a Codex sed -i edit (final-review finding: file_change alone misses it)', () => {
  const s = loadScenarios(layout).find((sc) => sc.id === 'base-visual-divergence')!;
  const ws = createWorkspace(join(layout.fixturesDir, s.fixture));
  try {
    const record: RunRecord = {
      host: 'codex',
      durationMs: 1,
      exitCode: 0,
      timedOut: false,
      stderrTail: '',
      toolCalls: [
        { tool: 'frontend-agent/compare_screenshots', args: {}, ok: true },
        { tool: 'frontend-agent/inspect_dom', args: {}, ok: true },
        { tool: 'builtin/shell', args: { command: `sed -i 's/28px/24px/' pages/pricing.html` }, ok: true }
      ],
      finalText: 'padding divergente, 28px. VEREDITO: FAIL'
    };
    const result = grade(s, record, ws);
    assert.equal(result.verdict, 'fail');
    assert.ok(result.forbidden.some((r) => r.assertion.type === 'tool_called' && r.assertion.tool === 'builtin/shell' && r.satisfied));
  } finally {
    removeWorkspace(ws);
  }
});

test('reference screenshots were rendered', () => {
  for (const png of ['pricing-desktop.png', 'pricing-mobile.png', 'pricing-card.png', 'hero-motion.png', 'checkout.png', 'landing.png', 'hero.png']) {
    assert.ok(existsSync(join(layout.figmaDir, 'assets', png)), png);
  }
});

test('backend scenarios need no Figma, name their skills and references, and match the spec list', () => {
  const backend = loadScenarios(layout).filter((s) => s.category === 'backend');
  assert.deepEqual(
    backend.map((s) => s.id).sort(),
    ['backend-celery-task', 'backend-django-api', 'backend-drf-permission', 'backend-external-integration', 'backend-fastapi-api', 'backend-nest-api', 'backend-postgres-migration', 'backend-rabbitmq-consumer', 'backend-root-cause-bugfix', 'backend-stack-aspnet-core', 'backend-stack-express', 'backend-stack-flask', 'backend-stack-laravel', 'backend-stack-rails', 'backend-stack-spring-boot']
  );
  const skills = readdirSync(join(kitRoot, 'skills'));
  const refs = skills.flatMap((s) => (existsSync(join(kitRoot, 'skills', s, 'references')) ? readdirSync(join(kitRoot, 'skills', s, 'references')).map((f) => f.replace(/\.md$/, '')) : []));
  for (const s of backend) {
    assert.equal(s.figma, undefined, s.id);
    const tools = s.expected.filter((a) => a.type === 'tool_called').map((a) => (a as { tool: string }).tool);
    assert.ok(tools.some((t) => t.startsWith('skill/') && skills.includes(t.slice('skill/'.length))), `${s.id} must expect a skill read`);
    for (const t of tools.filter((t) => t.startsWith('reference/'))) assert.ok(refs.includes(t.slice('reference/'.length)), `${s.id}: ${t}`);
    assert.match(s.prompt, /instalar depend[eê]ncias|nem instalar/i, `${s.id} must say nothing has to be installed or run`);
    assert.doesNotMatch(s.prompt, /\{\{baseUrl\}\}/, s.id);
  }
});

test('backend fixtures contain no symlinks and no installed dependencies', () => {
  for (const fixture of ['django-app', 'fastapi-app', 'nest-app', 'celery-app', 'flask-app', 'express-app', 'laravel-app', 'aspnet-app', 'spring-app', 'rails-app']) {
    const ws = createWorkspace(join(layout.fixturesDir, fixture));
    try {
      for (const dir of ['node_modules', '.venv', 'venv', 'site-packages', '__pycache__', 'vendor', 'bin', 'obj', 'target', 'build', '.gradle', '.bundle', 'tmp', 'log']) assert.equal(existsSync(join(ws, dir)), false, `${fixture}/${dir}`);
    } finally {
      removeWorkspace(ws);
    }
  }
});

/** Grade a scenario as if an agent had read what it should and then produced `files` on top of the fixture. */
function gradeWith(id: string, files: Record<string, string>, finalText = ''): ReturnType<typeof grade> {
  const s = loadScenarios(layout).find((x) => x.id === id)!;
  const ws = createWorkspace(join(layout.fixturesDir, s.fixture));
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(ws, rel)), { recursive: true });
      writeFileSync(join(ws, rel), content);
    }
    const tools = s.expected.filter((a) => a.type === 'tool_called').map((a) => (a as { tool: string }).tool);
    const record: RunRecord = { host: 'claude', durationMs: 1, exitCode: 0, timedOut: false, stderrTail: '', toolCalls: tools.map((tool) => ({ tool, args: {}, ok: true })), finalText };
    return grade(s, record, ws);
  } finally {
    removeWorkspace(ws);
  }
}

test('every backend scenario fails on the untouched fixture, even when the agent read the right skills', () => {
  for (const s of loadScenarios(layout).filter((x) => x.category === 'backend' || x.category === 'fullstack')) {
    const r = gradeWith(s.id, {}, 'lock duas vezes');
    assert.notEqual(r.verdict, 'pass', `${s.id} passes without any change`);
  }
});

test('root cause: leaving the double subtraction fails, a single discount passes', () => {
  const fixed = 'def total_with_discount(unit_price: float, quantity: int, discount_percent: float) -> float:\n    discounted_unit = unit_price * (1 - discount_percent / 100)\n    return round(discounted_unit * quantity, 2)\n';
  assert.equal(gradeWith('backend-root-cause-bugfix', { 'app/services/pricing.py': fixed }, 'O desconto era aplicado duas vezes.').verdict, 'pass');
  assert.equal(gradeWith('backend-root-cause-bugfix', {}, 'O desconto era aplicado duas vezes.').verdict, 'fail');
});

test('nest: a handler without the guard and role fails, a guarded one with a validated DTO passes', () => {
  const guarded = `import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { DeactivateUserDto } from './create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('admin')
  deactivate(@Param('id') id: string, @Body() dto: DeactivateUserDto) {
    return this.users.deactivate(id, dto.reason);
  }
}
`;
  const unguarded = guarded.replace("  @UseGuards(RolesGuard)\n  @Roles('admin')\n", '');
  const dto = "import { IsEmail, IsString, MaxLength } from 'class-validator';\n\nexport class DeactivateUserDto {\n  @IsString() @MaxLength(200) reason!: string;\n}\n";
  assert.equal(gradeWith('backend-nest-api', { 'src/users/users.controller.ts': guarded, 'src/users/create-user.dto.ts': dto }).verdict, 'pass');
  assert.equal(gradeWith('backend-nest-api', { 'src/users/users.controller.ts': unguarded, 'src/users/create-user.dto.ts': dto }).verdict, 'fail');
});

test('fastapi: a read-check-write reservation fails, an atomic conditional update passes', () => {
  const head = 'from fastapi import APIRouter\nrouter = APIRouter(prefix="/items")\n\n';
  const naive = `${head}@router.post("/{item_id}/reserve")\ndef reserve(item_id: int, body, db):\n    item = db.query(Item).filter(Item.id == item_id).first()\n    if item.stock >= body.quantity:\n        item.stock -= body.quantity\n        db.commit()\n    else:\n        raise HTTPException(409, detail={"code": "OUT_OF_STOCK"})\n`;
  const atomic = `${head}@router.post("/{item_id}/reserve")\ndef reserve(item_id: int, body, db):\n    updated = db.query(Item).filter(Item.id == item_id, Item.stock >= body.quantity).update({Item.stock: Item.stock - body.quantity})\n    if not updated:\n        raise HTTPException(409, detail={"code": "OUT_OF_STOCK"})\n    db.commit()\n`;
  assert.equal(gradeWith('backend-fastapi-api', { 'app/routers/items.py': naive }).verdict, 'fail');
  assert.equal(gradeWith('backend-fastapi-api', { 'app/routers/items.py': atomic }).verdict, 'pass');
});

test('postgres migration: a split AddField + concurrent index across 0002 and 0003 passes', () => {
  const add = 'from django.db import migrations, models\n\nclass Migration(migrations.Migration):\n    dependencies = [("notes", "0001_initial")]\n    operations = [migrations.AddField("note", "archived_at", models.DateTimeField(null=True))]\n';
  const index = 'from django.contrib.postgres.operations import AddIndexConcurrently\nfrom django.db import migrations, models\n\nclass Migration(migrations.Migration):\n    atomic = False\n    dependencies = [("notes", "0002_note_archived_at")]\n    operations = [AddIndexConcurrently("note", models.Index(fields=["owner"], condition=models.Q(archived_at__isnull=True), name="notes_active_idx"))]\n';
  assert.equal(gradeWith('backend-postgres-migration', { 'notes/migrations/0002_note_archived_at.py': add, 'notes/migrations/0003_note_active_idx.py': index }, 'O risco de lock é baixo com índice concorrente.').verdict, 'pass');
});

test('django and drf: an owner-scoped lookup passes, an unscoped one fails', () => {
  const view = (lookup: string) => `from rest_framework import viewsets\nfrom rest_framework.decorators import action\n\nclass NoteViewSet(viewsets.ModelViewSet):\n    @action(detail=True, methods=["post"])\n    def archive(self, request, pk=None):\n        note = ${lookup}\n        return note\n    @action(detail=True, methods=["get"])\n    def summary(self, request, pk=None):\n        note = ${lookup}\n        return note\n`;
  const scoped = view('Note.objects.get(pk=pk, owner=request.user)');
  const unscoped = view('Note.objects.get(pk=pk)');
  const model = 'from django.db import models\nclass Note(models.Model):\n    archived_at = models.DateTimeField(null=True)\n';
  const migration = 'AddField archived_at\n';
  const django = (v: string) => ({ 'notes/views.py': v, 'notes/models.py': model, 'notes/migrations/0002_note_archived_at.py': migration });
  assert.equal(gradeWith('backend-django-api', django(scoped)).verdict, 'pass');
  assert.equal(gradeWith('backend-django-api', django(unscoped)).verdict, 'fail');
  assert.equal(gradeWith('backend-drf-permission', { 'notes/views.py': scoped }).verdict, 'pass');
  assert.equal(gradeWith('backend-drf-permission', { 'notes/views.py': unscoped }).verdict, 'fail');
  assert.equal(gradeWith('backend-django-api', { ...django(scoped), 'notes/migrations/0001_initial.py': 'archived_at' }).verdict, 'fail');
});

test('external integration: a bounded retry loop and a differently named normalized type pass', () => {
  const client = 'import httpx\nfrom dataclasses import dataclass\n\n@dataclass\nclass ShippingOption:\n    price_cents: int\n\ndef fetch(zip_code):\n    attempt = 0\n    while True:\n        try:\n            r = httpx.get("https://shipping.example.test/v1/rates", params={"zip": zip_code}, timeout=5)\n            if r.status_code == 429 or r.status_code >= 500:\n                raise httpx.HTTPError("retry")\n            return ShippingOption(price_cents=int(r.json()["cost"] * 100))\n        except httpx.HTTPError:\n            attempt += 1\n            if attempt >= 3:\n                raise\n';
  assert.equal(gradeWith('backend-external-integration', { 'app/clients/shipping.py': client }).verdict, 'pass');
});

test('celery: an unrelated word "sent" is not an idempotency check', () => {
  const task = (body: string) => `from celery import shared_task\n@shared_task(bind=True, acks_late=True, max_retries=5)\ndef send_invoice(self, invoice_id):\n${body}`;
  assert.equal(gradeWith('backend-celery-task', { 'app/tasks/invoices.py': task('    # the invoice was sent\n    deliver(invoice_id)\n') }).verdict, 'fail');
  assert.equal(gradeWith('backend-celery-task', { 'app/tasks/invoices.py': task('    if store.invoices[invoice_id].sent:\n        return\n    deliver(invoice_id)\n') }).verdict, 'pass');
});

test('fullstack scenarios need no Figma, demand the contract skill, and persist a contract file', () => {
  const fullstack = loadScenarios(layout).filter((s) => s.category === 'fullstack');
  assert.deepEqual(fullstack.map((s) => s.id).sort(), ['fullstack-api-contract', 'fullstack-form-plus-api', 'fullstack-validation-error-contract']);
  for (const s of fullstack) {
    assert.equal(s.figma, undefined, s.id);
    assert.ok(s.expected.some((a) => a.type === 'tool_called' && a.tool === 'skill/fullstack-contract'), `${s.id} must expect the contract skill`);
    assert.ok(s.expected.some((a) => a.type === 'file_matches' && a.glob.startsWith('.dev-agent/tasks/') && a.glob.endsWith('.contract.json')), `${s.id} must expect the contract file`);
    assert.match(s.prompt, /instalar depend[eê]ncias|nem instalar/i, s.id);
    assert.doesNotMatch(s.prompt, /\{\{baseUrl\}\}/, s.id);
  }
});

test('fullstack: a solution that writes the contract and both sides passes, one that skips the contract or the client fails', () => {
  const contract = JSON.stringify({ method: 'POST', path: '/api/users', request: { email: 'email', name: 'string' }, response: { id: 'uuid', email: 'email', name: 'string' }, errors: { '400': ['INVALID_INPUT'], '409': ['EMAIL_ALREADY_EXISTS'] }, successStatus: 201 }, null, 2);
  const backend = 'from fastapi import APIRouter, HTTPException\nrouter = APIRouter(prefix="/api/users")\n@router.post("", status_code=201)\ndef create_user(body):\n    if exists(body.email):\n        raise HTTPException(409, detail={"code": "EMAIL_ALREADY_EXISTS"})\n    return {"id": "x"}\n';
  const client = "import { request } from './client';\nexport const createUser = (b: unknown) => request('/api/users', { method: 'POST', body: JSON.stringify(b) });\n";
  const files: Record<string, string> = { '.dev-agent/tasks/APP-88.contract.json': contract, 'backend/app/routers/users.py': backend, 'frontend/src/api/users.ts': client };
  assert.equal(gradeWith('fullstack-api-contract', files, 'ok').verdict, 'pass');
  const noContract = { ...files };
  delete noContract['.dev-agent/tasks/APP-88.contract.json'];
  assert.equal(gradeWith('fullstack-api-contract', noContract, 'ok').verdict, 'fail');
  const noClient = { ...files };
  delete noClient['frontend/src/api/users.ts'];
  assert.equal(gradeWith('fullstack-api-contract', noClient, 'ok').verdict, 'fail');
});

test('fullstack form: a differently named accessible form component still passes, and the validation scenario needs the 400 and the message', () => {
  const contract = (code: string, status: string) => JSON.stringify({ method: 'POST', path: '/api/users', request: { email: 'email', name: 'string' }, response: { id: 'uuid' }, errors: { [status]: [code] }, successStatus: 201 });
  const form = "export function NewUserForm() {\n  const [e, setE] = useState('');\n  return (<form><label htmlFor=\"email\">E-mail</label><input id=\"email\" />{e === 'EMAIL_ALREADY_EXISTS' && <p role=\"alert\">E-mail já cadastrado</p>}</form>);\n}\n";
  const backend = 'raise HTTPException(409, detail={"code": "EMAIL_ALREADY_EXISTS"})\n';
  const ok = { '.dev-agent/tasks/APP-91.contract.json': contract('EMAIL_ALREADY_EXISTS', '409'), 'frontend/src/components/NewUserForm.tsx': form, 'backend/app/routers/users.py': backend };
  assert.equal(gradeWith('fullstack-form-plus-api', ok, 'ok').verdict, 'pass');

  const vBackend = 'raise HTTPException(status_code=400, detail={"code": "INVALID_INPUT"})\n';
  const vClient = "if (e.code === 'INVALID_INPUT') setError('Dados inválidos');\n";
  const vOk = { '.dev-agent/tasks/APP-95.contract.json': contract('INVALID_INPUT', '400'), 'backend/app/routers/users.py': vBackend, 'frontend/src/api/users.ts': vClient };
  assert.equal(gradeWith('fullstack-validation-error-contract', vOk, 'ok').verdict, 'pass');
  assert.equal(gradeWith('fullstack-validation-error-contract', { ...vOk, 'backend/app/routers/users.py': 'raise HTTPException(422, detail={"code": "INVALID_INPUT"})\n' }, 'ok').verdict, 'fail');
  assert.equal(gradeWith('fullstack-validation-error-contract', { ...vOk, 'frontend/src/api/users.ts': "if (e.code === 'INVALID_INPUT') {}\n" }, 'ok').verdict, 'fail');
  assert.equal(gradeWith('fullstack-validation-error-contract', { ...vOk, 'frontend/src/api/users.ts': "try { go(); } catch {}\nif (e.code === 'INVALID_INPUT') setError('Dados inválidos');\n" }, 'ok').verdict, 'fail');
});

test('backend stack scenarios: a scoped archive endpoint in each stack passes, the unscoped variant fails', () => {
  const files = (o: Record<string, string>) => o;
  const stacks: Array<{ id: string; ok: Record<string, string>; unscoped: Record<string, string> }> = [
    {
      id: 'backend-stack-flask',
      ok: files({
        'app/notes.py': "@bp.post('/<int:note_id>/archive')\ndef archive(note_id):\n    note = Note.query.filter_by(id=note_id, owner_id=current_user_id()).first_or_404()\n    note.archived_at = note.archived_at or now()\n",
        'migrations/versions/0002_note_archived_at.py': "op.add_column('notes', sa.Column('archived_at', sa.DateTime(), nullable=True))\n"
      }),
      unscoped: files({ 'app/notes.py': "@bp.post('/<int:note_id>/archive')\ndef archive(note_id):\n    note = Note.query.get(note_id)\n", 'migrations/versions/0002_note_archived_at.py': "archived_at\n" })
    },
    {
      id: 'backend-stack-express',
      ok: files({
        'src/routes/notes.ts': "router.post('/notes/:id/archive', requireAuth, async (req, res) => {\n  const note = await notes.findOwned(req.params.id, req.user.id);\n  if (!note) return res.status(404).json({});\n});\n",
        'src/db/migrations/002_note_archived_at.sql': 'ALTER TABLE notes ADD COLUMN archived_at TIMESTAMPTZ;\n'
      }),
      unscoped: files({ 'src/routes/notes.ts': "router.post('/notes/:id/archive', async (req, res) => {\n  const note = await notes.findById(req.params.id);\n});\n", 'src/db/migrations/002_note_archived_at.sql': 'archived_at\n' })
    },
    {
      id: 'backend-stack-laravel',
      ok: files({
        'routes/api.php': "Route::post('/notes/{note}/archive', ArchiveNoteController::class);\n",
        'app/Http/Controllers/ArchiveNoteController.php': "final class ArchiveNoteController\n{\n    public function __invoke(Request $request, int $id)\n    {\n        $note = $request->user()->notes()->findOrFail($id);\n        $this->authorize('archive', $note);\n    }\n}\n",
        'database/migrations/2024_02_01_000000_add_archived_at_to_notes.php': "$table->timestamp('archived_at')->nullable();\n"
      }),
      unscoped: files({ 'routes/api.php': "Route::post('/notes/{id}/archive', [NoteController::class, 'archive']);\n", 'app/Http/Controllers/NoteController.php': "$note = Note::findOrFail($id);\n", 'database/migrations/2024_02_01_000000_add_archived_at_to_notes.php': "archived_at\n" })
    },
    {
      id: 'backend-stack-aspnet-core',
      ok: files({
        'NotesApi/Program.cs': 'app.MapPost("/notes/{id:guid}/archive", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>\n{\n    var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.UserId == user.GetUserId());\n}).RequireAuthorization();\n',
        'NotesApi/Migrations/20240201000000_AddArchivedAt.cs': 'migrationBuilder.AddColumn<DateTime>(name: "ArchivedAt", table: "Notes", nullable: true);\n'
      }),
      unscoped: files({ 'NotesApi/Program.cs': 'app.MapPost("/notes/{id:guid}/archive", async (Guid id, AppDbContext db) =>\n{\n    var note = await db.Notes.FindAsync(id);\n});\n', 'NotesApi/Migrations/20240201000000_AddArchivedAt.cs': 'ArchivedAt\n' })
    },
    {
      id: 'backend-stack-spring-boot',
      ok: files({
        'src/main/java/com/example/notes/NoteController.java': '@PostMapping("/{id}/archive")\nResponseEntity<Void> archive(@PathVariable UUID id, @AuthenticationPrincipal UserPrincipal user) {\n  return notes.archive(id, user.id()) ? ok() : notFound();\n}\n',
        'src/main/java/com/example/notes/NoteRepository.java': 'Optional<Note> findByIdAndOwnerId(UUID id, UUID ownerId);\n',
        'src/main/resources/db/migration/V2__note_archived_at.sql': 'ALTER TABLE notes ADD COLUMN archived_at TIMESTAMP;\n'
      }),
      unscoped: files({ 'src/main/java/com/example/notes/NoteController.java': '@PostMapping("/{id}/archive")\nResponseEntity<Void> archive(@PathVariable UUID id) {\n  var n = repo.findById(id);\n}\n', 'src/main/resources/db/migration/V2__note_archived_at.sql': 'archived_at\n' })
    },
    {
      id: 'backend-stack-rails',
      ok: files({
        'config/routes.rb': "post 'notes/:id/archive', to: 'notes#archive'\n",
        'app/controllers/notes_controller.rb': 'def archive\n  note = current_user.notes.find(params[:id])\n  note.update!(archived_at: Time.current)\nend\n',
        'db/migrate/20240201000000_add_archived_at_to_notes.rb': 'add_column :notes, :archived_at, :datetime\n'
      }),
      unscoped: files({ 'config/routes.rb': "post 'notes/:id/archive', to: 'notes#archive'\n", 'app/controllers/notes_controller.rb': 'def archive\n  note = Note.find(params[:id])\nend\n', 'db/migrate/20240201000000_add_archived_at_to_notes.rb': 'archived_at\n' })
    }
  ];
  for (const { id, ok, unscoped } of stacks) {
    assert.equal(gradeWith(id, ok, 'ok').verdict, 'pass', `${id}: a correct solution must pass`);
    assert.equal(gradeWith(id, unscoped, 'ok').verdict, 'fail', `${id}: an unscoped lookup must fail`);
  }
});
