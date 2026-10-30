import { Hono } from "hono";

import { getHiggsfieldStatus } from "../lib/higgsfield";

export const statusRoute = new Hono();

statusRoute.get("/status", async (c) => {
  const refresh = ["1", "true"].includes(c.req.query("refresh") ?? "");
  const result = await getHiggsfieldStatus({ refresh });

  // Known states return 200 so callers can always read the `status` field.
  // Unexpected failures (CLI crash, timeout, bad output) surface as 503.
  return c.json(result, result.status === "error" ? 503 : 200);
});
