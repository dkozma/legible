import { Router } from "express"

import { listOrders } from "./orders"

export const routes = Router()

routes.get("/orders", async (_req, res) => {
  res.json(await listOrders())
})
