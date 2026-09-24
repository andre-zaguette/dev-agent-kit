---
name: celery
description: Baseline conventions for Celery tasks: retries, acknowledgment timing, idempotency, serialization and time limits.
status: baseline
---

## Princípio

Tasks must be idempotent and small: pass identifiers, retry only failures that can succeed later, bound run time, and let late acknowledgment cover a crashed worker.

## Quando aplicar

Projects with `celery` in their requirements.

## Quando não aplicar

Direct broker consumers written without Celery: use the broker's reference. Do not change a project's broker or result backend as part of a task.

## Exemplo

```python
@shared_task(
    bind=True,
    acks_late=True,
    autoretry_for=(TemporaryError,),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=5,
    soft_time_limit=60,
)
def send_invoice(self, invoice_id: int) -> None:
    invoice = Invoice.objects.get(pk=invoice_id)
    if invoice.sent_at:
        return  # idempotent: a duplicate delivery is a no-op
    deliver(invoice)
    Invoice.objects.filter(pk=invoice_id, sent_at__isnull=True).update(sent_at=timezone.now())
```

Enqueue after the transaction commits (`transaction.on_commit`), pass ids not objects, use JSON serialization, and test with eager mode plus a test that runs the task twice.

## Fonte

Celery documentation (tasks, retrying, reliability); refined per project conventions.
