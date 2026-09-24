def total_with_discount(unit_price: float, quantity: int, discount_percent: float) -> float:
    """Order total after a percentage discount."""
    discounted_unit = unit_price * (1 - discount_percent / 100)
    subtotal = discounted_unit * quantity
    return round(subtotal - subtotal * discount_percent / 100, 2)
