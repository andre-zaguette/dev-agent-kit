from app.routers.users import list_users


def test_list_users_returns_the_seed_user():
    assert list_users()[0]["email"] == "ana@example.test"
