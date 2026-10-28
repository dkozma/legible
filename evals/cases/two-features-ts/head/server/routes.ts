import { Router } from "express"

import { exportOrders } from "./exportOrders"
import { listOrders } from "./orders"

export const routes = Router()

routes.get("/orders", async (_req, res) => {
  res.json(await listOrders())
})

routes.get("/orders.csv", async (_req, res) => {
  res.type("text/csv").send(await exportOrders())
})
