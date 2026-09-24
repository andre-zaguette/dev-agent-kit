---
name: external-integrations
description: Integrate third-party services safely with timeouts, retry rules, rate-limit handling and a normalized boundary so vendor details never leak into the domain. Use when calling or receiving calls from an external API, webhook or SDK.
---

# External Integrations

Assume the other side is slow, wrong, rate-limited and changing.

## Decide for every integration

- timeout: an explicit one, on every call
- retryable failures (network, 5xx, 429) versus non-retryable ones (4xx validation, auth); retries use backoff and a cap
- 429 and rate limits: honor the server's hint, and do not amplify load
- 5xx behavior and circuit-breaking when failures pile up
- auth refresh: how expired credentials are renewed without leaking them
- schema drift: validate responses, tolerate unknown fields, fail loudly on missing required ones
- idempotency: can a retried call duplicate a side effect? Use the vendor's key or your own
- partial failure: what state is left when step two of three fails, and how it is repaired
- observability: log the call, latency and outcome without secrets or full payloads

## Rules

- Normalize vendor responses into your own types at the integration boundary; the domain never sees vendor shapes.
- Keep the client behind a small interface so tests can replace it.
- Store credentials in the project's secret mechanism, never in code or logs.
- Test the failure paths, not only the success path.
