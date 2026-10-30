import { Hono } from "hono";

import { statusRoute } from "./routes/status";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.route("/", statusRoute);

export default app;
