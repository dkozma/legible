export interface Order {
  id: string
  customer: string
  totalCents: number
}

export async function listOrders(): Promise<Order[]> {
  return []
}
