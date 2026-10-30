import type { Context } from "hono";

import type { AuthEnv } from "../middleware/auth";

export function meHandler(c: Context<AuthEnv>) {
  const user = c.get("user");

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? "user",
    },
    capabilities: c.get("capabilities"),
  });
}
