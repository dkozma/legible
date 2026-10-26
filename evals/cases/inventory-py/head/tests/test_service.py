from inventory.models import Item
from inventory.service import needs_reorder


def test_needs_reorder_below_level():
    assert needs_reorder(Item("a", quantity=4, reorder_level=5))


def test_no_reorder_at_level():
    assert not needs_reorder(Item("a", quantity=5, reorder_level=5))


def test_safety_stock_raises_the_reorder_point():
    assert needs_reorder(Item("a", quantity=12, reorder_level=10, safety_stock=5))
