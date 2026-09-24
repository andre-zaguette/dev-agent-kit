---
name: celery
description: Baseline conventions for Celery tasks: retries, acknowledgment timing, idempotency, serialization and time limits.
status: baseline
---

## Princípio

Tasks must be idempotent and small: pass identifiers, retry only failures that can succeed later, bound run time, and claim the work atomically so two deliveries of one message cannot both act. Late acknowledgment redelivers after a worker crash, but a killed child process is acknowledged unless `task_reject_on_worker_lost` is enabled.

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
    # claim first with a conditional update: only one concurrent delivery gets rowcount == 1
    claimed = Invoice.objects.filter(pk=invoice_id, status="pending").update(status="sending")
    if not claimed:
        return  # already sent, or being sent by another delivery
    try:
        deliver(Invoice.objects.get(pk=invoice_id), idempotency_key=f"invoice-{invoice_id}")
    except TemporaryError:
        Invoice.objects.filter(pk=invoice_id).update(status="pending")  # release the claim so the retry can run
        raise
    Invoice.objects.filter(pk=invoice_id).update(status="sent", sent_at=timezone.now())
```

A crash between `deliver` and the final update can still resend, so pass the provider an idempotency key and enable `task_reject_on_worker_lost` when a killed child must be redelivered.

Enqueue after the transaction commits (`transaction.on_commit`), pass ids not objects, use JSON serialization, and test with eager mode plus a test that runs the task twice.

## Fonte

Celery documentation (tasks, retrying, reliability); refined per project conventions.
