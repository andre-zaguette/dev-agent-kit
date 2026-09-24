---
name: async-jobs
description: Design background jobs and message consumers that survive duplicates, retries and failures, with explicit acknowledgment, retry limits and dead-lettering. Use when adding or changing a queue producer, consumer, scheduled job or worker task.
---

# Async Jobs and Queues

Assume at-least-once delivery unless the actual infrastructure guarantees otherwise. Load the queue's file from `references/` after detecting it.

## Decide

- message schema: versioned, validated on both ends
- producer: when is the message published relative to the database commit?
- consumer: acknowledgment strategy (ack only after the work is durable)
- retry strategy and maximum retries, with backoff
- dead-letter behavior for messages that keep failing
- idempotency: processing the same message twice must be safe when the domain requires it
- ordering: what breaks if messages arrive out of order?
- poison messages: how a bad message is isolated instead of blocking the queue
- observability: message id, attempt count, duration, outcome

## Rules

- Never do work and acknowledge in the wrong order: acknowledging first loses messages, acknowledging never duplicates them.
- Make handlers idempotent with a natural key or a processed-message record, not with hope.
- Keep payloads small: identifiers and versions, not whole objects that may go stale.
- Test the retry and duplicate paths, not only the first delivery.
