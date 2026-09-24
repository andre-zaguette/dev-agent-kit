---
name: observability
description: Add logs, metrics and traces that explain what a backend did and why it failed, without leaking sensitive data. Use when adding new backend flows, failure handling, jobs or integrations, or when a failure cannot be diagnosed from what is logged.
---

# Observability

Make the next failure diagnosable from the outside.

## Do

- Use the project's logger and its structured format; one event per fact, with named fields.
- Carry a correlation or request identifier through calls, jobs and outgoing requests when the project has one.
- Log the decision points and failures: what was attempted, the identifiers involved, the outcome, the error class and message.
- Count and time what matters: requests, errors, latency, queue depth, retries, dead-lettered messages, when the project exposes metrics.
- Keep log levels meaningful: errors for actionable failures, not for expected validation rejections.

## Never log

- passwords, tokens, keys, session identifiers, authorization headers
- personal or payment data, full request or response bodies
- anything you would not paste into a public ticket

## Rules

- Do not add a logging or metrics library the project does not use.
- Log once at the boundary that handles the error; do not log and rethrow at every layer.
