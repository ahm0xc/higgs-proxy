import { hc } from "hono/client";
import type { AppType } from "api";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:5561";

export const api = hc<AppType>(baseUrl);
