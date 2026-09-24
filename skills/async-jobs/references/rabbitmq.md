---
name: rabbitmq
description: Baseline conventions for RabbitMQ consumers and producers: acknowledgments, dead-lettering, retries and idempotency.
status: baseline
---

## Princípio

Acknowledge a message only after its work is durable, route failures to a dead-letter exchange after a bounded number of attempts, and make handlers safe against redelivery.

## Quando aplicar

Projects that use RabbitMQ directly (a client library) or through a framework.

## Quando não aplicar

Other brokers, or a task framework that already manages acknowledgments for you: read its reference instead of duplicating its behavior.

## Exemplo

```python
MAX_ATTEMPTS = 5


def attempts(properties) -> int:
    deaths = (properties.headers or {}).get("x-death") or []
    return sum(entry.get("count", 0) for entry in deaths)


def on_message(channel, method, properties, body):
    try:
        message = OrderMessage.model_validate_json(body)  # a malformed body is rejected below, never fatal
        with db.transaction():
            if processed.exists(message.id):
                return channel.basic_ack(method.delivery_tag)
            handle(message)
            processed.add(message.id)
        channel.basic_ack(method.delivery_tag)
    except RetryableError:
        if attempts(properties) >= MAX_ATTEMPTS:
            channel.basic_reject(method.delivery_tag, requeue=False)  # give up: dead-letter for a human
        else:
            channel.basic_nack(method.delivery_tag, requeue=False)  # to the retry queue (a TTL queue that dead-letters back)
    except Exception:
        channel.basic_reject(method.delivery_tag, requeue=False)  # poison message: never redeliver it in a loop

channel.queue_declare("orders", durable=True, arguments={"x-dead-letter-exchange": "orders.retry"})
channel.basic_qos(prefetch_count=10)
```

The retry queue holds a message for a delay (per-queue TTL) and dead-letters it back to `orders`; RabbitMQ counts each trip in the `x-death` header, which is how the attempt limit is enforced. After the limit, reject to a final dead-letter queue that people inspect.

Declare queues durable, publish persistent messages, keep a prefetch limit, use manual acknowledgments, and record the message id you processed. Never requeue a failing message in a tight loop; use a dead-letter exchange with a delay or a retry cap.

## Fonte

RabbitMQ documentation (reliability, acknowledgments, dead-letter exchanges); refined per project conventions.
