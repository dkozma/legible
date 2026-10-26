from dataclasses import dataclass


@dataclass
class Item:
    sku: str
    quantity: int
    reorder_level: int
    safety_stock: int = 0
