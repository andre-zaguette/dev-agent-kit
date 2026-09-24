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
def on_message(channel, method, properties, body):
    message = OrderMessage.model_validate_json(body)
    try:
        with db.transaction():
            if processed.exists(message.id):
                return channel.basic_ack(method.delivery_tag)
            handle(message)
            processed.add(message.id)
        channel.basic_ack(method.delivery_tag)
    except RetryableError:
        channel.basic_nack(method.delivery_tag, requeue=False)  # dead-letter or delayed retry queue
    except Exception:
        channel.basic_reject(method.delivery_tag, requeue=False)  # poison message

channel.queue_declare("orders", durable=True, arguments={"x-dead-letter-exchange": "orders.dlx"})
channel.basic_qos(prefetch_count=10)
```

Declare queues durable, publish persistent messages, keep a prefetch limit, use manual acknowledgments, and record the message id you processed. Never requeue a failing message in a tight loop; use a dead-letter exchange with a delay or a retry cap.

## Fonte

RabbitMQ documentation (reliability, acknowledgments, dead-letter exchanges); refined per project conventions.
