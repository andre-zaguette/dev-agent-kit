from celery import shared_task

from app.mailer import send_mail, TemporaryMailError


@shared_task(bind=True, acks_late=True, autoretry_for=(TemporaryMailError,), retry_backoff=True, max_retries=3)
def send_welcome(self, user_id: int) -> None:
    send_mail(user_id, template="welcome")
