# Instalação passo a passo (v1.1)

Este guia leva do zero até um projeto de teste com o Dev Agent Kit funcionando, no Claude Code e/ou no Codex.

## O que você precisa

- **Node.js 20.6 ou mais novo** e npm (`node -v` para conferir).
- **Git**.
- **Claude Code** e/ou **Codex** instalado no PC. O kit escreve os arquivos para os hosts que encontrar.
- Um projeto para testar (pode ser vazio, mas com Git para usar `diff review`).

## Passo 1 — Instalar o kit no PC

Escolha uma das duas formas.

### A. Pelo tarball do release (mais simples)

```bash
curl -LO https://github.com/andre-zaguette/dev-agent-kit/releases/download/v1.3.0/dev-agent-kit-1.3.0.tgz
npm install -g ./dev-agent-kit-1.3.0.tgz
```

### B. Pelo código-fonte

```bash
git clone https://github.com/andre-zaguette/dev-agent-kit.git
cd dev-agent-kit
npm install
npm link
```

## Passo 2 — Conferir a instalação

```bash
dev-agent --version
```

Deve imprimir `1.3.0`. Os comandos `frontend-agent` e `frontend-agent-kit` também foram instalados, como aliases de `install` e `verify`.

## Passo 3 — Instalar o navegador (só para validação visual)

As ferramentas de screenshot e diff visual usam o Chromium do Playwright. Instale uma vez:

```bash
# instalação global
cd "$(npm root -g)/dev-agent-kit" && npx playwright install chromium

# instalação pelo código-fonte
cd /caminho/do/dev-agent-kit && npx playwright install chromium
```

Se você só vai testar tarefas, workspaces e `diff review`, pode pular este passo.

## Passo 4 — Instalar no projeto

Dentro do projeto de teste, ou apontando para ele com `--project`:

```bash
dev-agent install --project /caminho/do/projeto
dev-agent verify  --project /caminho/do/projeto
```

O `install` escreve **somente dentro do projeto**:

| O quê | Onde |
|---|---|
| Skills | `.claude/skills/` e `.agents/skills/` |
| Instruções (bloco gerenciado) | `CLAUDE.md` e `AGENTS.md` |
| Servidor MCP | `.mcp.json` e `.codex/config.toml` |

Seu conteúdo e outros servidores MCP são preservados. Uma skill que você editou localmente é mantida e avisada; `--force` sobrescreve. `--no-figma` não configura o servidor do Figma. Para instalar só em um host: `dev-agent install claude` ou `dev-agent install codex`.

O `verify` deve terminar sem falhas (código de saída 0).

## Passo 5 — Aprovar o servidor MCP

- **Claude Code:** ao abrir o projeto, ele pede para aprovar o servidor MCP do projeto. Aprove.
- **Codex:** só carrega `.codex/config.toml` em projetos confiáveis. Marque o projeto como confiável.

O `.mcp.json` e o `.codex/config.toml` têm caminhos absolutos do kit instalado. Não faça commit deles em repositório compartilhado.

## Passo 6 — Primeiro teste rápido

Na raiz do projeto:

```bash
dev-agent inspect                # linguagens, frameworks e comandos detectados
dev-agent context audit          # tamanho do contexto sempre carregado
dev-agent repo index             # mapa do repositório
dev-agent diff review            # revisa o branch atual (precisa de Git)
```

## Passo 7 — Configurar uma fonte de tarefas (opcional)

Crie `.dev-agent/config.yml` no projeto:

```yaml
baseBranch: main
taskSources:
  company:
    adapter: generic-mcp
    server: company-tasks
    default: true
    identifiers:
      - '^HEF-\d+$'
    tools:
      get: { name: get_issue, arg: key }
    mapping:
      key: key
      title: summary
      description: description
      status: status.name
```

Confira e resolva um identificador:

```bash
dev-agent sources verify
dev-agent task resolve HEF-123
```

No Claude Code ou no Codex, peça: *"Analise e execute HEF-123."* Mais detalhes: `docs/generic-mcp.md` e `docs/task-orchestrator.md`.

## Passo 8 — Testar workspaces (novo na v1.1)

Monte uma pasta que **não** seja repositório, com repositórios dentro:

```text
meu-workspace/
  .dev-agent/config.yml
  models/      (repositório Git)
  backend/     (repositório Git)
```

`meu-workspace/.dev-agent/config.yml`:

```yaml
workspaces:
  models:  { path: models,  role: library }
  backend: { path: backend, role: backend, dependsOn: [models] }
```

Depois, a partir de qualquer lugar:

```bash
dev-agent workspaces        --project /caminho/meu-workspace
dev-agent workspaces verify --project /caminho/meu-workspace
dev-agent workspaces order  --project /caminho/meu-workspace
dev-agent diff review --workspace all --project /caminho/meu-workspace
```

Guia completo, com os exemplos edge-platform e layered-suite: `docs/workspaces.md`.

## Atualizar

Instale o tarball da nova versão do mesmo jeito do passo 1 e rode `dev-agent install --project ...` de novo em cada projeto. No código-fonte: `git pull && npm install`.

## Desinstalar

```bash
npm uninstall -g dev-agent-kit
```

Isso remove o kit do PC. Nos projetos, apague o que o `install` criou (tabela do passo 4): as skills do kit, o bloco gerenciado em `CLAUDE.md`/`AGENTS.md` e as entradas do servidor em `.mcp.json` e `.codex/config.toml`.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `could not find tsx` no `install` | As dependências do kit não estão instaladas. Reinstale o kit (ou rode `npm install` no checkout) e repita o `install`. |
| `dev-agent: command not found` | O diretório global do npm não está no `PATH`, ou o `npm link` não foi feito. |
| Erro de versão do Node | Atualize para Node 20.6 ou mais novo. |
| `--project` relativo aponta para o lugar errado | Use caminho absoluto. |
| MCP não aparece no Claude Code | Você ainda não aprovou o servidor do projeto (passo 5). |

Sem o CLI, a instalação manual está em `docs/manual-install.md`.
