from app.services.pricing import total_with_discount


def test_no_discount():
    assert total_with_discount(100, 2, 0) == 200


def test_bulk_discount_is_applied_once():
    assert total_with_discount(100, 2, 10) == 180
