from inventory.models import Item


def needs_reorder(item: Item) -> bool:
    return item.quantity < item.reorder_level


def restock(item: Item, units: int) -> Item:
    item.quantity += units
    return item
