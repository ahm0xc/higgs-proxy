import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";

import { allowedOrigins, authBaseUrl, authSecret } from "./config";
import { db } from "./db";
import { schema } from "./db/schema";

export const auth = betterAuth({
  baseURL: authBaseUrl,
  secret: authSecret,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
    transaction: true,
  }),
  trustedOrigins: allowedOrigins,

  emailAndPassword: {
    enabled: true,
    // The public sign-up endpoint is disabled below (see `disabledPaths`).
    // The only way in is the first-run setup route or an admin-created user.
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh at most once a day
    cookieCache: { enabled: false },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },

  advanced: {
    cookiePrefix: "higgs",
  },

  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
  ],

  disabledPaths: [
    // No public sign-up: the first admin comes from POST /setup, everyone
    // else from the admin panel.
    "/sign-up/email",
    // Impersonation is a power this app deliberately does not expose.
    "/admin/impersonate-user",
    "/admin/stop-impersonating",
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];
