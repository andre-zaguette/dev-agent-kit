---
name: generic-mcp
description: Declare an MCP-backed task source in .dev-agent/config.yml with tool names and a field mapping, without writing an adapter.
type: contract
---

# generic-mcp source

    taskSources:
      company:                      # user-defined alias
        adapter: generic-mcp
        server: company-tasks       # MCP server name
        default: true               # at most one source
        identifiers:                # optional but preferred
          - '^HEF-\d+$'             # single quotes, ONE backslash
        tools:
          get:         { name: get_issue, arg: key }        # arg = parameter that receives the identifier
          search:      { name: search_issues, list: results }
          comments:    { name: get_comments, list: comments }
          attachments: { name: get_attachments }
          links:       { name: get_links }
        mapping:
          id: id
          key: key                  # required
          title: summary            # required
          description: description
          status: status.name       # dotted paths
          comments: { body: text, author: user.name, createdAt: created }

A source with a different payload only changes `mapping`:

    mapping: { id: ticket_id, key: reference, title: subject, description: body, status: state }

- `list` is the dotted path to the array inside a tool result (default: the result itself).
- Item fields: id, key, title, description, acceptanceCriteria, status, type, priority, labels, assigneeId, assigneeName, url.
- Collection fields: comments (id, author, body, createdAt), attachments (id, name, mimeType, url), links (type, key, url, title). Unmapped ones default to the same name.
- Mapping paths are dotted own-property lookups; numeric segments index arrays.
- Tool results may be plain values or MCP envelopes; JSON text is parsed.
- Config holds no secrets. Authentication belongs to the MCP server.

Common mistakes: double backslash in `identifiers`, more than one `default`, `mapping.key` or `mapping.title` missing. The parser rejects all three.
