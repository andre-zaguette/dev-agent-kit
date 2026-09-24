import json

import pika

from app.models import store


def handle_order(payload: dict) -> None:
    store.invoices[payload["order_id"]] = None  # placeholder for the real handler


def on_message(channel, method, properties, body):
    payload = json.loads(body)
    handle_order(payload)
    channel.basic_ack(method.delivery_tag)


def main() -> None:
    connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
    channel = connection.channel()
    channel.queue_declare("orders", durable=True)
    channel.basic_qos(prefetch_count=10)
    channel.basic_consume("orders", on_message)
    channel.start_consuming()
