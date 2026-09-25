from app import create_app


def test_list_requires_authentication():
    client = create_app({"TESTING": True}).test_client()
    assert client.get("/notes").status_code == 401
