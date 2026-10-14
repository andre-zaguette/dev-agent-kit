# Native task sources

A native task source reads a work item straight from the tracker's HTTP API. Use it when no MCP server is installed, in CI, or when you want one command that behaves the same on every host. If your tracker already has a good MCP server, the declarative [generic-mcp](generic-mcp.md) mapping keeps working and needs no token in your shell.

Four adapters ship: `github-issues`, `linear`, `jira` and `youtrack`. Those names are reserved: a config that used one of them for a custom adapter must rename it.

## How it works

```yaml
taskSources:
  work:
    adapter: linear
    tokenEnv: LINEAR_API_KEY
    default: true
    identifiers: ['^ENG-\d+$']
```

`tokenEnv` is the **name** of an environment variable. The value is read at run time and never written to the config, the ledger, the state or any output.

```bash
export LINEAR_API_KEY=...            # in your shell, never in the repository
dev-agent sources verify             # checks the config and that the variable is set (never prints it)
dev-agent task fetch ENG-123         # a short summary
dev-agent task fetch ENG-123 --json  # the canonical WorkItem
```

A handled failure exits `2` and its first word says why:

| First word | Meaning |
|---|---|
| `unresolved:` | No source matched the identifier, or the source is not native (read it through its MCP server). |
| `not-found:` | The tracker has no such item. |
| `auth:` | The token variable is unset, or the tracker rejected the token. |
| `unavailable:` | Network, rate limit or server error. The kit never retries on its own. |

Every adapter is read-only: it never comments on, transitions or links an item. Requests use HTTPS only, give up after 15 seconds, refuse answers over 2 MB, and never follow a redirect (so the token cannot be sent to another host). At most 100 comments are read; when a list is cut or a lookup fails, the item's `metadata.partial` names it. Attachments are metadata only.

## GitHub Issues

```yaml
  tracker:
    adapter: github-issues
    repo: acme/app            # default repository
    tokenEnv: GITHUB_TOKEN
    identifiers: ['^#\d+$']
```

Identifiers: `owner/name#123`, `#123` or `123` (the last two use `repo`). `baseUrl` is optional and points at a self-hosted API (for example `https://ghe.example.com/api/v3`). The work item `key` is `<repo>-<number>` so it can name a ledger file; `metadata.reference` holds `acme/app#123`. Pull requests are returned by the same endpoint and have `type: pull-request`. Links are not read (capability `false`). The token needs read access to Issues ([creating a fine-grained token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)).

## Linear

```yaml
  work:
    adapter: linear
    tokenEnv: LINEAR_API_KEY
    identifiers: ['^ENG-\d+$']
```

The endpoint is fixed. Identifier: the issue key (`ENG-123`). Parent, children and relations become links, and attachments are listed. The personal API key is sent as the raw `Authorization` value, as Linear documents; a read-only key is enough ([API keys](https://linear.app/docs/api-and-webhooks)).

## Jira

```yaml
  jira:
    adapter: jira
    baseUrl: https://acme.example.net
    tokenEnv: JIRA_API_TOKEN
    emailEnv: JIRA_EMAIL          # Jira Cloud (auth: cloud, the default)
    identifiers: ['^PROJ-\d+$']
```

For a self-hosted instance use `auth: bearer`, drop `emailEnv` and put a personal access token in `tokenEnv`. Cloud uses the v3 API (descriptions come as Atlassian Document Format and are converted to plain text); self-hosted uses v2. Identifier: the issue key. Issue links, parent and sub-tasks become links. The account needs permission to browse the project and read its issues ([API tokens for Atlassian accounts](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/), [personal access tokens](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)).

## YouTrack

```yaml
  tracker:
    adapter: youtrack
    baseUrl: https://tracker.example.com      # include a context path if you have one
    tokenEnv: YOUTRACK_TOKEN
    identifiers: ['^PROJ-\d+$']
```

Identifier: the issue id (`PROJ-123`). State, priority, type and assignee come from the issue's custom fields, tags become labels, and link directions are mapped to parent, child, blocks and blocked-by. The permanent token needs read access to the project ([permanent tokens](https://www.jetbrains.com/help/youtrack/devportal/Manage-Permanent-Token.html)).

## Not covered

Writing to a tracker, downloading attachment content, OAuth flows, `search`, and any custom field beyond the canonical work item.
