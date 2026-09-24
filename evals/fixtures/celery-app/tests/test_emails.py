from app.tasks.emails import send_welcome


def test_send_welcome_is_a_registered_task():
    assert send_welcome.name.endswith("send_welcome")
