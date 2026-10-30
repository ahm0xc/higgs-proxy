import { Hono } from "hono";
import { cors } from "hono/cors";

import { statusHandler } from "./routes/status";

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5560")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

const routes = app
  .get("/", (c) => c.text("Hello Hono!"))
  .get("/status", statusHandler);

export type AppType = typeof routes;
export type {
  HiggsfieldStatus,
  HiggsfieldStatusResponse,
} from "./lib/higgsfield";

export default {
  port: Number(process.env.PORT ?? 5561),
  fetch: routes.fetch,
};
