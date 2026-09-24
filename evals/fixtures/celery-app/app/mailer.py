class TemporaryMailError(Exception):
    """The mail provider is temporarily unavailable."""


def send_mail(user_id: int, template: str) -> None:
    raise NotImplementedError
