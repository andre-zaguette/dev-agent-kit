import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { detectProjectProfile } from '../src/project-profile.ts';
import { commitFile, makeRepo } from './helpers.ts';

function project(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dak-profile-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('npm project: scripts become commands, frameworks come from dependencies', () => {
  const p = project({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest', lint: 'eslint .', typecheck: 'tsc --noEmit', dev: 'vite' },
      dependencies: { react: '^18' },
      devDependencies: { typescript: '^5', tailwindcss: '^3' }
    }),
    'package-lock.json': '{}',
    'tsconfig.json': '{}'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['typescript']);
    assert.deepEqual(profile.frameworks.sort(), ['react', 'tailwind']);
    assert.equal(profile.packageManager, 'npm');
    assert.deepEqual(profile.testCommands, ['npm test']);
    assert.deepEqual(profile.lintCommands, ['npm run lint']);
    assert.deepEqual(profile.typecheckCommands, ['npm run typecheck']);
    assert.equal(profile.docker, false);
  } finally {
    p.cleanup();
  }
});

test('pnpm lockfile switches the command runner', () => {
  const p = project({ 'package.json': JSON.stringify({ scripts: { test: 'vitest', 'type-check': 'tsc' } }), 'pnpm-lock.yaml': '' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.equal(profile.packageManager, 'pnpm');
    assert.deepEqual(profile.testCommands, ['pnpm test']);
    assert.deepEqual(profile.typecheckCommands, ['pnpm type-check']);
    assert.deepEqual(profile.languages, ['javascript']);
  } finally {
    p.cleanup();
  }
});

test('Nest project with prisma, postgres compose and bullmq', () => {
  const p = project({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10', bullmq: '^5' } }),
    'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.frameworks, ['nestjs']);
    assert.equal(profile.database, 'postgresql');
    assert.equal(profile.migrationTool, 'prisma');
    assert.equal(profile.queue, 'bullmq');
    assert.equal(profile.docker, true);
  } finally {
    p.cleanup();
  }
});

test('Django + DRF + celery + rabbitmq project uses tool config for commands when nothing else exists', () => {
  const p = project({
    'manage.py': '',
    'requirements.txt': 'Django==5.0\ndjangorestframework==3.15\ncelery==5\npytest\nruff\nmypy\npsycopg2-binary\n',
    'docker-compose.yml': 'services:\n  mq:\n    image: rabbitmq:3\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['python']);
    assert.deepEqual(profile.frameworks.sort(), ['django', 'drf']);
    assert.equal(profile.migrationTool, 'django');
    assert.equal(profile.database, 'postgresql');
    assert.equal(profile.queue, 'rabbitmq');
    assert.deepEqual(profile.testCommands, ['pytest']);
    assert.deepEqual(profile.lintCommands, ['ruff check .']);
    assert.deepEqual(profile.typecheckCommands, ['mypy .']);
  } finally {
    p.cleanup();
  }
});

test('django-cors-headers alone does not make a project Django', () => {
  const p = project({ 'requirements.txt': 'fastapi\ndjango-cors-headers\n' });
  try {
    assert.deepEqual(detectProjectProfile(p.dir).frameworks, ['fastapi']);
  } finally {
    p.cleanup();
  }
});

test('a Makefile target beats a tool-config guess; a package script beats a Makefile target', () => {
  const p = project({ 'pyproject.toml': '[tool.pytest]\n', Makefile: 'test:\n\tpytest -q\nlint:\n\truff .\n' });
  const q = project({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }), Makefile: 'test:\n\techo other\n' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.testCommands, ['make test']);
    assert.deepEqual(profile.lintCommands, ['make lint']);
    assert.deepEqual(detectProjectProfile(q.dir).testCommands, ['npm test']);
  } finally {
    p.cleanup();
    q.cleanup();
  }
});

test('malformed package.json and empty directories never throw', () => {
  const bad = project({ 'package.json': '{ not json' });
  const empty = project({});
  try {
    const badProfile = detectProjectProfile(bad.dir);
    assert.deepEqual(badProfile.languages, []);
    assert.deepEqual(badProfile.testCommands, []);
    const emptyProfile = detectProjectProfile(empty.dir);
    assert.deepEqual(emptyProfile, {
      languages: [],
      frameworks: [],
      testCommands: [],
      lintCommands: [],
      typecheckCommands: [],
      docker: false
    });
  } finally {
    bad.cleanup();
    empty.cleanup();
  }
});

test('baseBranch is filled from git when the project is a repo', () => {
  const dir = makeRepo('main');
  try {
    commitFile(dir, 'a.txt');
    assert.equal(detectProjectProfile(dir).baseBranch, 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-string packageManager never throws and falls back to lockfile / npm', () => {
  const a = project({ 'package.json': JSON.stringify({ packageManager: 5, scripts: { test: 'x' } }) });
  const b = project({ 'package.json': JSON.stringify({ packageManager: {} }), 'pnpm-lock.yaml': '' });
  try {
    const profileA = detectProjectProfile(a.dir);
    assert.equal(profileA.packageManager, 'npm');
    assert.deepEqual(profileA.testCommands, ['npm test']);
    assert.equal(detectProjectProfile(b.dir).packageManager, 'pnpm');
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test('bun projects run package scripts with bun run', () => {
  const p = project({ 'package.json': JSON.stringify({ scripts: { test: 'vitest' } }), 'bun.lockb': '' });
  try {
    assert.deepEqual(detectProjectProfile(p.dir).testCommands, ['bun run test']);
  } finally {
    p.cleanup();
  }
});

test('redis and every queue technology are detected, not just the first', () => {
  const p = project({
    'pyproject.toml': '[project]\ndependencies = ["celery", "redis"]\n',
    'docker-compose.yml': 'services:\n  mq:\n    image: rabbitmq:3\n'
  });
  const bare = project({ 'README.md': 'x' });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.equal(profile.cache, 'redis');
    assert.deepEqual(profile.queues, ['rabbitmq', 'celery']);
    assert.equal(profile.queue, 'rabbitmq');
    assert.equal(detectProjectProfile(bare.dir).cache, undefined);
    assert.equal(detectProjectProfile(bare.dir).queues, undefined);
  } finally {
    p.cleanup();
    bare.cleanup();
  }
});

test('message and cache clients are detected from libraries, not only from Compose files', () => {
  const cases: Array<[Record<string, string>, { queues?: string[]; cache?: string }]> = [
    [{ 'requirements.txt': 'pika==1.3\n' }, { queues: ['rabbitmq'] }],
    [{ 'requirements.txt': 'aio-pika\n' }, { queues: ['rabbitmq'] }],
    [{ 'package.json': JSON.stringify({ dependencies: { amqplib: '^0.10' } }) }, { queues: ['rabbitmq'] }],
    [{ 'package.json': JSON.stringify({ dependencies: { 'amqp-connection-manager': '^4' } }) }, { queues: ['rabbitmq'] }],
    [{ 'requirements.txt': 'django-redis\n' }, { cache: 'redis' }],
    [{ 'requirements.txt': 'requests\n' }, {}]
  ];
  for (const [files, expected] of cases) {
    const p = project(files);
    try {
      const profile = detectProjectProfile(p.dir);
      assert.deepEqual(profile.queues, expected.queues, JSON.stringify(files));
      assert.equal(profile.cache, expected.cache, JSON.stringify(files));
    } finally {
      p.cleanup();
    }
  }
});

const j = (v: unknown) => JSON.stringify(v);

test('Laravel: composer manifest, phpunit, pint and the database from .env.example', () => {
  const p = project({
    'composer.json': j({ require: { 'laravel/framework': '^11' }, 'require-dev': { 'phpunit/phpunit': '^11', 'laravel/pint': '^1' } }),
    '.env.example': 'APP_NAME=x\nDB_CONNECTION=mysql\n'
  });
  try {
    const profile = detectProjectProfile(p.dir);
    assert.deepEqual(profile.languages, ['php']);
    assert.deepEqual(profile.frameworks, ['laravel']);
    assert.equal(profile.packageManager, 'composer');
    assert.deepEqual(profile.testCommands, ['vendor/bin/phpunit']);
    assert.deepEqual(profile.lintCommands, ['vendor/bin/pint --test']);
    assert.equal(profile.database, 'mysql');
    assert.equal(profile.migrationTool, 'laravel');
  } finally {
    p.cleanup();
  }
  const scripted = project({ 'composer.json': j({ require: { 'laravel/framework': '^11' }, scripts: { test: 'phpunit', lint: 'pint', analyse: 'phpstan' } }) });
  try {
    const profile = detectProjectProfile(scripted.dir);
    assert.deepEqual([profile.testCommands, profile.lintCommands, profile.typecheckCommands], [['composer test'], ['composer lint'], ['composer analyse']]);
  } finally {
    scripted.cleanup();
  }
});

test('PHP: Symfony is detected without a migration tool; a plain library has no framework; other databases and clients', () => {
  const sym = project({ 'composer.json': j({ require: { 'symfony/framework-bundle': '^7' } }) });
  const lib = project({ 'composer.json': j({ require: { 'monolog/monolog': '^3' } }) });
  const infra = project({ 'composer.json': j({ require: { 'laravel/framework': '^11', 'php-amqplib/php-amqplib': '^3', 'predis/predis': '^2' } }), '.env': 'DB_CONNECTION=pgsql\n' });
  const sqlsrv = project({ 'composer.json': j({ require: { 'laravel/framework': '^11' } }), '.env.example': 'DB_CONNECTION=sqlsrv\n' });
  try {
    const s = detectProjectProfile(sym.dir);
    assert.deepEqual([s.frameworks, s.migrationTool], [['symfony'], undefined]);
    assert.deepEqual([detectProjectProfile(lib.dir).languages, detectProjectProfile(lib.dir).frameworks], [['php'], []]);
    const i = detectProjectProfile(infra.dir);
    assert.deepEqual([i.database, i.queues, i.cache], ['postgresql', ['rabbitmq'], 'redis']);
    assert.equal(detectProjectProfile(sqlsrv.dir).database, 'sqlserver');
  } finally {
    [sym, lib, infra, sqlsrv].forEach((x) => x.cleanup());
  }
});

test('C#: ASP.NET Core from the web SDK, EF Core, database packages, queue and cache; console apps and a lone solution', () => {
  const web = project({
    'Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8"/><PackageReference Include="Microsoft.EntityFrameworkCore" Version="8"/><PackageReference Include="RabbitMQ.Client" Version="6"/><PackageReference Include="StackExchange.Redis" Version="2"/></ItemGroup></Project>'
  });
  const console = project({ 'Tool/Tool.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>' });
  const sln = project({ 'App.sln': 'Microsoft Visual Studio Solution File' });
  const sqlserver = project({ 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8"/></Project>' });
  const mysql = project({ 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PackageReference Include="Pomelo.EntityFrameworkCore.MySql" Version="8"/></Project>' });
  try {
    const w = detectProjectProfile(web.dir);
    assert.deepEqual([w.languages, w.frameworks, w.packageManager], [['csharp'], ['aspnetcore'], 'dotnet']);
    assert.deepEqual([w.testCommands, w.typecheckCommands], [['dotnet test'], ['dotnet build']]);
    assert.deepEqual([w.database, w.migrationTool, w.queues, w.cache], ['postgresql', 'efcore', ['rabbitmq'], 'redis']);
    const c = detectProjectProfile(console.dir);
    assert.deepEqual([c.languages, c.frameworks], [['csharp'], []]);
    assert.deepEqual(detectProjectProfile(sln.dir).languages, ['csharp']);
    assert.equal(detectProjectProfile(sqlserver.dir).database, 'sqlserver');
    assert.equal(detectProjectProfile(mysql.dir).database, 'mysql');
  } finally {
    [web, console, sln, sqlserver, mysql].forEach((x) => x.cleanup());
  }
});

test('Java: Spring Boot with Maven or Gradle, database, migration tool, queue and cache; a Gradle project without Spring', () => {
  const maven = project({
    'pom.xml': '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency><dependency><groupId>org.postgresql</groupId></dependency><dependency><artifactId>flyway-core</artifactId></dependency><dependency><artifactId>spring-boot-starter-amqp</artifactId></dependency><dependency><artifactId>spring-boot-starter-data-redis</artifactId></dependency></dependencies></project>'
  });
  const gradle = project({ 'build.gradle.kts': 'plugins { id("org.springframework.boot") } dependencies { implementation("org.springframework.boot:spring-boot-starter-web"); runtimeOnly("com.mysql:mysql-connector-j") }', gradlew: '#!/bin/sh' });
  const gradleNoWrapper = project({ 'build.gradle': 'dependencies { implementation "org.springframework.boot:spring-boot-starter-web"; runtimeOnly "com.microsoft.sqlserver:mssql-jdbc" }' });
  const plain = project({ 'build.gradle': 'plugins { id "java-library" }' });
  const liquibase = project({ 'pom.xml': '<project><artifactId>spring-boot-starter</artifactId><artifactId>liquibase-core</artifactId></project>' });
  try {
    const m = detectProjectProfile(maven.dir);
    assert.deepEqual([m.languages, m.frameworks, m.packageManager, m.testCommands], [['java'], ['spring'], 'maven', ['mvn test']]);
    assert.deepEqual([m.database, m.migrationTool, m.queues, m.cache], ['postgresql', 'flyway', ['rabbitmq'], 'redis']);
    const g = detectProjectProfile(gradle.dir);
    assert.deepEqual([g.packageManager, g.testCommands, g.frameworks, g.database], ['gradle', ['./gradlew test'], ['spring'], 'mysql']);
    const n = detectProjectProfile(gradleNoWrapper.dir);
    assert.deepEqual([n.testCommands, n.database], [['gradle test'], 'sqlserver']);
    assert.deepEqual([detectProjectProfile(plain.dir).languages, detectProjectProfile(plain.dir).frameworks], [['java'], []]);
    assert.equal(detectProjectProfile(liquibase.dir).migrationTool, 'liquibase');
  } finally {
    [maven, gradle, gradleNoWrapper, plain, liquibase].forEach((x) => x.cleanup());
  }
});

test('Ruby: Rails, RSpec, RuboCop, PostgreSQL, Redis and RabbitMQ from the Gemfile; a Gemfile without Rails', () => {
  const rails = project({ Gemfile: "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\ngem \"pg\"\ngem 'rspec-rails'\ngem 'rubocop'\ngem 'sidekiq'\ngem 'bunny'\n" });
  const minitest = project({ Gemfile: "gem 'rails'\ngem 'mysql2'\n" });
  const plain = project({ Gemfile: "source 'https://rubygems.org'\ngem 'rake'\n" });
  try {
    const r = detectProjectProfile(rails.dir);
    assert.deepEqual([r.languages, r.frameworks, r.packageManager], [['ruby'], ['rails'], 'bundler']);
    assert.deepEqual([r.testCommands, r.lintCommands, r.database, r.migrationTool, r.cache, r.queues], [['bundle exec rspec'], ['bundle exec rubocop'], 'postgresql', 'rails', 'redis', ['rabbitmq']]);
    const m = detectProjectProfile(minitest.dir);
    assert.deepEqual([m.testCommands, m.database], [['bin/rails test'], 'mysql']);
    const p = detectProjectProfile(plain.dir);
    assert.deepEqual([p.languages, p.frameworks, p.testCommands], [['ruby'], [], []]);
  } finally {
    [rails, minitest, plain].forEach((x) => x.cleanup());
  }
});

test('Flask is detected from requirements, but flask-cors alone is not Flask', () => {
  const flask = project({ 'requirements.txt': 'flask==3.0\n' });
  const cors = project({ 'requirements.txt': 'flask-cors\n' });
  try {
    assert.deepEqual(detectProjectProfile(flask.dir).frameworks, ['flask']);
    assert.deepEqual(detectProjectProfile(cors.dir).frameworks, []);
  } finally {
    flask.cleanup();
    cors.cleanup();
  }
});

test('several ecosystems in one repository keep every signal, in a stable order', () => {
  const p = project({
    'package.json': j({ dependencies: { express: '^4' } }),
    'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n',
    'pom.xml': '<project><artifactId>spring-boot-starter-web</artifactId></project>'
  });
  try {
    const a = detectProjectProfile(p.dir);
    assert.deepEqual(a.frameworks, ['express', 'fastapi', 'spring']);
    assert.deepEqual(a.languages, ['javascript', 'python', 'java']);
    assert.deepEqual(detectProjectProfile(p.dir), a);
  } finally {
    p.cleanup();
  }
});

test('hostile or huge manifests are read within bounds', () => {
  const started = performance.now();
  const files: Record<string, string> = { 'pom.xml': '<x/>\n'.repeat(1_000_000) + 'spring-boot' };
  for (let i = 0; i < 200; i++) files[`svc${i}/README.md`] = 'x';
  const p = project(files);
  try {
    detectProjectProfile(p.dir);
    assert.ok(performance.now() - started < 1500, `took ${Math.round(performance.now() - started)}ms`);
  } finally {
    p.cleanup();
  }
});

test('a Gemfile made of blank lines is scanned in linear time, and both gem call styles are recognized', () => {
  const started = performance.now();
  const hostile = project({ Gemfile: '\n'.repeat(120_000) + "gem 'rails'\n" });
  const paren = project({ Gemfile: "gem('rails')\ngem(\"pg\")\n" });
  try {
    detectProjectProfile(hostile.dir);
    assert.ok(performance.now() - started < 500, `took ${Math.round(performance.now() - started)}ms`);
    const p = detectProjectProfile(paren.dir);
    assert.deepEqual([p.frameworks, p.database], [['rails'], 'postgresql']);
  } finally {
    hostile.cleanup();
    paren.cleanup();
  }
});

test('odd composer.json shapes never throw', () => {
  for (const composer of [{ scripts: null }, { scripts: ['test'] }, { require: null }, { require: [] , 'require-dev': 5 }, []]) {
    const p = project({ 'composer.json': JSON.stringify(composer) });
    try {
      assert.deepEqual(detectProjectProfile(p.dir).languages, ['php'], JSON.stringify(composer));
    } finally {
      p.cleanup();
    }
  }
  const broken = project({ 'composer.json': '{ not json' });
  try {
    assert.deepEqual(detectProjectProfile(broken.dir).languages, ['php']);
  } finally {
    broken.cleanup();
  }
});

test('C# projects are found in the usual src/ layout and a busy root cannot hide them', () => {
  const layout = project({ 'Foo.sln': 'sln', 'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>', 'src/Core/Core.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>' });
  const files: Record<string, string> = { 'web/web.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' };
  for (let i = 0; i < 80; i++) files[`doc${String(i).padStart(2, '0')}.md`] = 'x';
  const busy = project(files);
  const skipped = project({ 'node_modules/x/x.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>', 'bin/y/y.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>' });
  try {
    assert.deepEqual(detectProjectProfile(layout.dir).frameworks, ['aspnetcore']);
    assert.deepEqual(detectProjectProfile(busy.dir).frameworks, ['aspnetcore']);
    assert.deepEqual(detectProjectProfile(skipped.dir).languages, []);
  } finally {
    layout.cleanup();
    busy.cleanup();
    skipped.cleanup();
  }
});

test('database and client detection: .env fallbacks, quoted values, StackExchangeRedis, Gradle catalogs and trilogy', () => {
  const fallback = project({ 'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11' } }), '.env.example': 'APP_NAME=x\n', '.env': 'DB_CONNECTION="pgsql"\n' });
  const sqlite = project({ 'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11' } }), '.env.example': 'DB_CONNECTION=sqlite\n' });
  const redis = project({ 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PackageReference Include="Microsoft.Extensions.Caching.StackExchangeRedis" Version="8"/></Project>' });
  const catalog = project({ 'build.gradle.kts': 'plugins { alias(libs.plugins.spring.boot) } dependencies { implementation(libs.spring.boot.starter.web) }' });
  const trilogy = project({ Gemfile: "gem 'rails'\ngem 'trilogy'\n" });
  try {
    assert.equal(detectProjectProfile(fallback.dir).database, 'postgresql');
    assert.equal(detectProjectProfile(sqlite.dir).database, undefined);
    assert.equal(detectProjectProfile(redis.dir).cache, 'redis');
    assert.deepEqual(detectProjectProfile(catalog.dir).frameworks, ['spring']);
    assert.equal(detectProjectProfile(trilogy.dir).database, 'mysql');
  } finally {
    [fallback, sqlite, redis, catalog, trilogy].forEach((x) => x.cleanup());
  }
});

test('a package script no longer hides the commands of the other ecosystems in the repository', () => {
  const node = { scripts: { test: 'vitest', lint: 'eslint .' } };
  const py = project({ 'package.json': j(node), 'requirements.txt': 'django\npytest\nruff\nmypy\n' });
  const rb = project({ 'package.json': j(node), Gemfile: "gem 'rails'\ngem 'rspec-rails'\ngem 'rubocop'\n" });
  const orchestrated = project({ 'package.json': j(node), 'requirements.txt': 'pytest\n', Makefile: 'test:\n\techo all\n' });
  try {
    const a = detectProjectProfile(py.dir);
    assert.deepEqual(a.testCommands, ['npm test', 'pytest']);
    assert.deepEqual(a.lintCommands, ['npm run lint', 'ruff check .']);
    assert.deepEqual(a.typecheckCommands, ['mypy .']);
    assert.deepEqual(detectProjectProfile(rb.dir).testCommands, ['npm test', 'bundle exec rspec']);
    assert.deepEqual(detectProjectProfile(orchestrated.dir).testCommands, ['npm test', 'pytest']);
  } finally {
    py.cleanup();
    rb.cleanup();
    orchestrated.cleanup();
  }
});

test('a Makefile target stays the single entry point even when other ecosystems are present', () => {
  const p = project({ Makefile: 'test:\n\techo all\n', 'requirements.txt': 'pytest\n', Gemfile: "gem 'rspec-rails'\n" });
  try {
    assert.deepEqual(detectProjectProfile(p.dir).testCommands, ['make test']);
  } finally {
    p.cleanup();
  }
});
