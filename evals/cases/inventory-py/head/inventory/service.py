from inventory.models import Item


def needs_reorder(item: Item) -> bool:
    return item.quantity < item.reorder_level + item.safety_stock


MAX_STOCK = 1000


def restock(item: Item, units: int) -> Item:
    item.quantity = min(item.quantity + units, MAX_STOCK)
    return item
