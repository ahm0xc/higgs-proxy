import { createMiddleware } from "hono/factory";

import type { AuthUser } from "../lib/auth";
import { auth } from "../lib/auth";
import type { Capabilities, Capability } from "../lib/capabilities";
import { ALL_CAPABILITIES, getCapabilities } from "../lib/capabilities";

export interface AuthVariables {
  user: AuthUser;
  capabilities: Capabilities;
}

export type AuthEnv = { Variables: AuthVariables };

/**
 * Resolves the better-auth session, then loads the user's media capabilities
 * once for the request. Fails closed: no session means 401, and a missing
 * capabilities row means no access.
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  const user = session.user;
  const isAdmin = user.role === "admin";

  c.set("user", user);
  c.set(
    "capabilities",
    isAdmin ? ALL_CAPABILITIES : await getCapabilities(user.id),
  );

  await next();
});

export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  await next();
});

/** Use after `requireAuth` on any route that generates media. */
export function requireCapability(capability: Capability) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const capabilities = c.get("capabilities");

    if (!capabilities?.[capability]) {
      return c.json(
        { error: `You do not have access to ${capability} generation` },
        403,
      );
    }

    await next();
  });
}
