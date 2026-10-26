import { listOrders, type Order } from "./orders"

const escape = (s: string) =>
  /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s

export function toCsv(orders: Order[]): string {
  const rows = orders.map((o) =>
    [o.id, escape(o.customer), (o.totalCents / 100).toFixed(2)].join(","),
  )
  return ["id,customer,total", ...rows].join("\n")
}

export async function exportOrders(): Promise<string> {
  return toCsv(await listOrders())
}
