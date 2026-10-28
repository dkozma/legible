from inventory.service import needs_reorder
from inventory.store import get_item


def reorder_status(sku: str) -> dict:
    item = get_item(sku)
    return {
        "sku": item.sku,
        "quantity": item.quantity,
        "safety_stock": item.safety_stock,
        "reorder": needs_reorder(item),
    }
