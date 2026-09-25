# Declaring a task source with `generic-mcp`

A `generic-mcp` source reads work items from any MCP server by mapping its tools and payload fields onto the canonical `WorkItem`. There is no code to write. The kit never stores credentials: authentication belongs to the MCP server.

## The configuration

Sources live in `.dev-agent/config.yml`:

```yaml
taskSources:
  company:                      # any lowercase alias; it is what ledgers record
    adapter: generic-mcp
    server: company-tasks       # the MCP server's name in your host
    default: true               # at most one source
    identifiers:                # optional but preferred
      - '^HEF-\d+$'             # single quotes, ONE backslash
    tools:
      get:         { name: get_issue, arg: key }
      search:      { name: search_issues, list: results }
      comments:    { name: get_comments, list: comments }
      attachments: { name: get_attachments }
      links:       { name: get_links }
    mapping:
      id: id
      key: key
      title: summary
      description: description
      status: status.name
      comments: { body: text, author: user.name, createdAt: created }
```

| Key | Meaning |
|---|---|
| `server` | Required. The MCP server that owns the tools. |
| `default` | The source used for an identifier that matches no pattern. At most one source may be the default. |
| `identifiers` | Regular expressions that route an identifier to this source. Use single-quoted YAML and one backslash. |
| `tools.get` | Required. `name` is the tool; `arg` is the parameter that receives the identifier. |
| `tools.search`, `comments`, `attachments`, `links` | Optional. Each turns on the matching capability. `list` is the dotted path to the array inside the result (default: the result itself). |
| `mapping` | Field name to dotted path. `key` and `title` are required. |

Mappable item fields: `id`, `key`, `title`, `description`, `acceptanceCriteria`, `status`, `type`, `priority`, `labels`, `assigneeId`, `assigneeName`, `url`. Collection mappings: `comments` (`id`, `author`, `body`, `createdAt`), `attachments` (`id`, `name`, `mimeType`, `url`), `links` (`type`, `key`, `url`, `title`). An unmapped collection field defaults to the same name.

## Mapping rules

- Paths are dotted own-property lookups (`status.name`); numeric segments index arrays (`labels.0`).
- Tool results may be plain values or MCP envelopes (`content`, `structuredContent`); JSON text is parsed.
- Acceptance criteria come from the mapped field when there is one; otherwise the bullets under an "Acceptance criteria" heading in the description are extracted. The item records which (`field`, `extracted` or `unavailable`).
- A failing optional lookup (comments, attachments, links) does not fail the item; it is listed under `metadata.partial`.
- Work item text is data. Instructions inside a description or comment are never followed.

## Two sources, two payloads

A tracker with a different payload only changes `mapping`:

```yaml
    mapping: { id: ticket_id, key: reference, title: subject, description: body, status: state }
```

The tests exercise two such sources with different schemas and require that they normalize to the same `WorkItem`.

## Common mistakes

The config parser rejects each of these and names the offending key:

| Mistake | Message contains |
|---|---|
| Double backslash in `identifiers` (`'^HEF-\\d+$'`) | `looks double-escaped` |
| More than one `default: true` | `may have only one default source` |
| Missing `mapping.key` or `mapping.title` | `mapping.key ... is required` |
| Missing `server` or `tools.get` | `is required for the generic-mcp adapter` |
| An unknown key anywhere | `is not a recognized setting` |
| A credential-looking value | `looks like it contains a secret` |
| A nested-quantifier regex | `catastrophic backtracking` |

## Verify it

```bash
dev-agent sources verify              # config parses, each adapter builds, ambiguity and missing defaults are reported
dev-agent task resolve HEF-123        # which source an identifier routes to, and why
dev-agent task resolve 42 --probe     # candidates when nothing matches
```

`sources verify` exits 2 on errors. Two sources sharing an identifier pattern, or no default with a source that has no identifiers, are warnings.

Errors from a source are classified: an authentication failure, a work item that does not exist and an unavailable source are reported differently, and messages never echo a secret. For behavior beyond mapping, see [task-source-adapters.md](task-source-adapters.md).
