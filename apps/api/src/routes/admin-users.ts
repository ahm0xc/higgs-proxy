import { desc, eq, inArray, like, max, or } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AuthEnv } from "../middleware/auth";
import type { Capabilities } from "../lib/capabilities";
import {
  NO_CAPABILITIES,
  getCapabilitiesFor,
  setCapabilities,
} from "../lib/capabilities";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { session, user } from "../lib/db/schema";
import { generatePassword } from "../lib/password";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 80;

type UserRow = typeof user.$inferSelect;

/** Better Auth throws APIError; turn it into something the client can read. */
function toHttpException(error: unknown): never {
  if (error instanceof HTTPException) throw error;

  const candidate = error as {
    status?: number | string;
    statusCode?: number;
    body?: { message?: string; code?: string };
    message?: string;
  };

  const code = candidate?.body?.code ?? "";

  // better-auth reports a duplicate email as a 400. The admin panel needs a
  // 409 so the form can highlight the email field instead of "server error".
  if (code.includes("USER_ALREADY_EXISTS")) {
    throw new HTTPException(409, {
      message: "A user with that email already exists",
    });
  }

  const status =
    typeof candidate?.statusCode === "number"
      ? candidate.statusCode
      : typeof candidate?.status === "number"
        ? candidate.status
        : undefined;

  if (status) {
    throw new HTTPException(status as 400, {
      message: candidate.body?.message ?? candidate.message ?? "Request failed",
    });
  }

  throw new HTTPException(500, { message: "Unexpected server error" });
}

async function findUserOrThrow(id: string | undefined): Promise<UserRow> {
  if (!id) {
    throw new HTTPException(404, { message: "User not found" });
  }

  const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);

  if (!rows[0]) {
    throw new HTTPException(404, { message: "User not found" });
  }

  return rows[0];
}

function forbidAdminTarget(target: UserRow) {
  if (target.role === "admin") {
    throw new HTTPException(400, {
      message:
        "The admin account cannot be changed here. Admins always have full access.",
    });
  }
}

function parseCapabilities(input: unknown): Capabilities {
  const value = (input ?? {}) as Record<string, unknown>;

  return {
    image: value.image === true,
    video: value.video === true,
    audio: value.audio === true,
  };
}

export async function listUsersHandler(c: Context<AuthEnv>) {
  const query = c.req.query();
  const search = (query.search ?? "").trim();
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(query.offset ?? 0) || 0, 0);

  const where = search
    ? or(
        like(user.email, `%${search.toLowerCase()}%`),
        like(user.name, `%${search}%`),
      )
    : undefined;

  const rows = await db
    .select()
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(limit)
    .offset(offset);

  const total = await db.$count(user, where);
  const ids = rows.map((row) => row.id);

  const capabilities = await getCapabilitiesFor(ids);

  const lastLogins =
    ids.length === 0
      ? []
      : await db
          .select({
            userId: session.userId,
            lastLoginAt: max(session.createdAt),
          })
          .from(session)
          .where(inArray(session.userId, ids))
          .groupBy(session.userId);

  const lastLoginByUser = new Map(
    lastLogins.map((row) => [row.userId, row.lastLoginAt]),
  );

  return c.json({
    users: rows.map((row) => {
      const lastLoginAt = lastLoginByUser.get(row.id);

      return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role ?? "user",
        banned: row.banned,
        createdAt: row.createdAt.toISOString(),
        lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
        capabilities:
          row.role === "admin"
            ? { image: true, video: true, audio: true }
            : (capabilities.get(row.id) ?? NO_CAPABILITIES),
      };
    }),
    total,
    limit,
    offset,
  });
}

export async function createUserHandler(c: Context<AuthEnv>) {
  const body = await c.req.json<{
    email?: unknown;
    name?: unknown;
    capabilities?: unknown;
  }>();

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const capabilities = parseCapabilities(body.capabilities);

  if (!EMAIL_PATTERN.test(email)) {
    throw new HTTPException(400, { message: "Enter a valid email address" });
  }

  if (name.length < 2 || name.length > MAX_NAME_LENGTH) {
    throw new HTTPException(400, {
      message: `Name must be between 2 and ${MAX_NAME_LENGTH} characters`,
    });
  }

  const password = generatePassword();

  const created = await auth.api
    .createUser({
      body: { email, name, password, role: "user" },
      headers: c.req.raw.headers,
    })
    .catch(toHttpException);

  await setCapabilities(created.user.id, capabilities);

  return c.json(
    {
      user: {
        id: created.user.id,
        name: created.user.name,
        email: created.user.email,
        role: "user",
        banned: false,
        createdAt: created.user.createdAt.toISOString(),
        lastLoginAt: null,
        capabilities,
      },
      // The only time this value is ever returned. It is not stored.
      password,
    },
    201,
  );
}

export async function resetPasswordHandler(c: Context<AuthEnv>) {
  const id = c.req.param("id");
  const target = await findUserOrThrow(id);
  forbidAdminTarget(target);

  const password = generatePassword();

  await auth.api
    .setUserPassword({
      body: { userId: target.id, newPassword: password },
      headers: c.req.raw.headers,
    })
    .catch(toHttpException);

  // The old password is gone, so every existing session must go too.
  await auth.api
    .revokeUserSessions({
      body: { userId: target.id },
      headers: c.req.raw.headers,
    })
    .catch(toHttpException);

  return c.json({ password });
}

export async function updateCapabilitiesHandler(c: Context<AuthEnv>) {
  const id = c.req.param("id");
  const target = await findUserOrThrow(id);
  forbidAdminTarget(target);

  const body = await c.req.json<{ capabilities?: unknown }>();
  const capabilities = await setCapabilities(
    target.id,
    parseCapabilities(body.capabilities),
  );

  return c.json({ capabilities });
}

export async function banUserHandler(c: Context<AuthEnv>) {
  const id = c.req.param("id");
  const target = await findUserOrThrow(id);
  forbidAdminTarget(target);

  if (target.id === c.get("user").id) {
    throw new HTTPException(400, { message: "You cannot disable yourself" });
  }

  await auth.api
    .banUser({
      body: { userId: target.id, banReason: "Disabled by an admin" },
      headers: c.req.raw.headers,
    })
    .catch(toHttpException);

  return c.json({ banned: true });
}

export async function unbanUserHandler(c: Context<AuthEnv>) {
  const id = c.req.param("id");
  const target = await findUserOrThrow(id);
  forbidAdminTarget(target);

  await auth.api
    .unbanUser({
      body: { userId: target.id },
      headers: c.req.raw.headers,
    })
    .catch(toHttpException);

  return c.json({ banned: false });
}

export async function deleteUserHandler(c: Context<AuthEnv>) {
  const id = c.req.param("id");
  const target = await findUserOrThrow(id);
  forbidAdminTarget(target);

  if (target.id === c.get("user").id) {
    throw new HTTPException(400, { message: "You cannot delete yourself" });
  }

  await auth.api
    .removeUser({
      body: { userId: target.id },
      headers: c.req.raw.headers,
    })
    .catch(toHttpException);

  return c.json({ deleted: true });
}
