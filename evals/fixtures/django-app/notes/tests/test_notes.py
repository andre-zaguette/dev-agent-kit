import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_owner_sees_only_own_notes():
    User = get_user_model()
    alice = User.objects.create_user("alice", password="x")
    bob = User.objects.create_user("bob", password="x")
    alice.notes.create(title="mine")
    bob.notes.create(title="theirs")
    client = APIClient()
    client.force_authenticate(alice)
    titles = [n["title"] for n in client.get("/api/notes/").json()]
    assert titles == ["mine"]
