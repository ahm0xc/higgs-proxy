import type { Context } from "hono";
import { eq } from "drizzle-orm";

import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { user } from "../lib/db/schema";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Single-process guard: two concurrent setup requests must not both create an
// admin. The route is only reachable while the instance is unclaimed anyway.
let setupInFlight = false;

export async function setupStatusHandler(c: Context) {
  const userCount = await db.$count(user);

  return c.json({ needsSetup: userCount === 0 });
}

export async function setupHandler(c: Context) {
  if (setupInFlight) {
    return c.json({ error: "Setup is already in progress" }, 409);
  }

  setupInFlight = true;

  try {
    if ((await db.$count(user)) > 0) {
      return c.json(
        { error: "Setup has already been completed. Sign in instead." },
        409,
      );
    }

    const body = await c.req.json<{
      email?: unknown;
      name?: unknown;
      password?: unknown;
    }>();

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!EMAIL_PATTERN.test(email)) {
      return c.json({ error: "Enter a valid email address" }, 400);
    }

    if (name.length < 2) {
      return c.json({ error: "Enter a name of at least 2 characters" }, 400);
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return c.json(
        {
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        },
        400,
      );
    }

    const result = await auth.api.signUpEmail({
      body: { email, name, password },
      returnHeaders: true,
    });

    // The first account is always the admin.
    await db
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.id, result.response.user.id));

    for (const cookie of result.headers.getSetCookie()) {
      c.header("set-cookie", cookie, { append: true });
    }

    return c.json(
      {
        user: {
          ...result.response.user,
          role: "admin",
        },
      },
      201,
    );
  } finally {
    setupInFlight = false;
  }
}
