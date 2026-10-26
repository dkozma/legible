from inventory.service import needs_reorder
from inventory.store import get_item


def reorder_status(sku: str) -> dict:
    item = get_item(sku)
    return {
        "sku": item.sku,
        "quantity": item.quantity,
        "reorder": needs_reorder(item),
    }
