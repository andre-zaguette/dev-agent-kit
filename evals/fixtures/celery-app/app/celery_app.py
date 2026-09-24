import os

from celery import Celery

celery_app = Celery("billing", broker=os.environ.get("BROKER_URL", "amqp://localhost"), backend=os.environ.get("RESULT_BACKEND", "redis://localhost:6379/0"))
celery_app.conf.task_serializer = "json"
celery_app.autodiscover_tasks(["app.tasks"])
