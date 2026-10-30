import { hc } from "hono/client";
import type { AppType } from "api";

export const apiBaseUrl =
  import.meta.env.VITE_API_URL ?? "http://localhost:5561";

export const api = hc<AppType>(apiBaseUrl, {
  init: {
    // Sessions live in an httpOnly cookie on the API origin.
    credentials: "include",
  },
});
