import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Better Auth tables. The shape is dictated by better-auth (core + the admin
 * plugin), so column names and nullability must match what the library
 * expects. Do not run `auth generate` over this file — it is written by hand.
 */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  // admin plugin
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // admin plugin
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * Per-user media capabilities. Owned by this app, not by better-auth.
 * A missing row is treated as "no access" (fail closed). Admins never get a
 * row — they bypass capability checks in the middleware.
 */
export const userCapabilities = sqliteTable("user_capabilities", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  canImage: integer("can_image", { mode: "boolean" }).notNull().default(false),
  canVideo: integer("can_video", { mode: "boolean" }).notNull().default(false),
  canAudio: integer("can_audio", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Image generation jobs.
 *
 * One row per `higgsfield generate create <model>` call. Video and audio get
 * their own tables later; nothing here is shared with them on purpose, because
 * the param sets and result shapes differ per media type.
 *
 * `params` holds the raw, model-specific params blob returned by the CLI
 * (`face_id`, `style_id`, `background`, `is_inpaint`, `batch_size`, ...) so we
 * never have to migrate a column per provider feature. The columns above it are
 * the ones the gallery actually filters/sorts/lays out on.
 */
export const imageGeneration = sqliteTable(
  "image_generation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Higgsfield side: job type is the model id (`text2image_soul_v2`, ...).
    providerJobId: text("provider_job_id"),
    model: text("model").notNull(),
    modelName: text("model_name").notNull(),

    prompt: text("prompt").notNull(),

    // Composition. width/height are what the provider actually returned, so the
    // gallery can lay the image out before the file loads.
    aspectRatio: text("aspect_ratio").notNull().default("1:1"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    resolution: text("resolution"),
    quality: text("quality"),
    seed: integer("seed"),

    // "queued" | "processing" | "completed" | "failed" | "cancelled"
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),

    resultUrl: text("result_url"),
    thumbnailUrl: text("thumbnail_url"),
    error: text("error"),

    params: text("params", { mode: "json" }).$type<Record<string, unknown>>(),

    creditsCost: integer("credits_cost"),
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    // The gallery query: this user's live images, newest first.
    index("image_generation_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    uniqueIndex("image_generation_provider_job_idx").on(table.providerJobId),
    index("image_generation_status_idx").on(table.status),
  ],
);

/**
 * Inputs attached to an image generation. `role` distinguishes plain
 * `image_references` from `mask`/`start_image`, since models accept 0–14 refs.
 * Kept separate so the count and ordering stay queryable.
 */
export const imageGenerationInput = sqliteTable(
  "image_generation_input",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => imageGeneration.id, { onDelete: "cascade" }),
    // "reference" | "mask" | "start_image"
    role: text("role").notNull().default("reference"),
    position: integer("position").notNull().default(0),
    // Either a Higgsfield upload id, or a URL we can show in the UI.
    uploadId: text("upload_id"),
    url: text("url"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("image_generation_input_generation_idx").on(table.generationId),
  ],
);

export const schema = {
  user,
  session,
  account,
  verification,
  userCapabilities,
  imageGeneration,
  imageGenerationInput,
};
