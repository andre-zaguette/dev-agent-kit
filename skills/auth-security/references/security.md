---
name: security
description: Baseline secure-coding checks for backend services: authorization patterns, input handling, secrets and common vulnerabilities.
status: baseline
---

## Princípio

Enforce security on the server at the boundary that owns the data: authenticate, authorize the specific object, validate input, and keep secrets out of code, logs and responses.

## Quando aplicar

Any backend change that reads identity, accepts input, stores data or calls another system.

## Quando não aplicar

Never skip it; scale the review to the change. Do not add a security library the project does not use.

## Exemplo

```python
# ownership check on the object, not just "logged in"
note = get_object_or_404(Note, pk=note_id, owner=request.user)

# parameterized query, never string building
cursor.execute("SELECT id FROM notes WHERE owner_id = %s AND title = %s", [user.id, title])

# whitelist writable fields
allowed = {"title", "body"}
payload = {k: v for k, v in body.items() if k in allowed}
```

Checklist: object-level authorization on every route including bulk and nested ones; no mass assignment; parameterized queries; no shell strings from input; no unsafe deserialization of untrusted data; restrict server-side requests to user URLs (SSRF): prefer an allowlist of hosts, otherwise resolve the host and reject private, loopback and link-local addresses, re-check after every redirect, and set a timeout and a response size cap; bounded uploads with checked type and storage path; rate limits on authentication; CORS and CSRF set for the real clients; no secrets or personal data in logs. Report what you verified and what you could not.

## Fonte

OWASP API Security Top 10 and Cheat Sheet Series; refined per project conventions.
