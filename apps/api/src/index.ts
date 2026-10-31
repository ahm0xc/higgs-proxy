import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { allowedOrigins } from "./lib/config";
import { auth } from "./lib/auth";
import type { AuthEnv } from "./middleware/auth";
import {
  requireAdmin,
  requireAuth,
  requireCapability,
} from "./middleware/auth";
import {
  banUserHandler,
  createUserHandler,
  deleteUserHandler,
  listUsersHandler,
  resetPasswordHandler,
  unbanUserHandler,
  updateCapabilitiesHandler,
} from "./routes/admin-users";
import {
  audioFileHandler,
  createAudioHandler,
  estimateAudioCostHandler,
  getAudioHandler,
  listAudioHandler,
  listVoicesHandler,
  voicePreviewAudioHandler,
  voicePreviewHandler,
} from "./routes/audio";
import { meHandler } from "./routes/me";
import {
  createImageHandler,
  downloadImageHandler,
  estimateImageCostHandler,
  getImageHandler,
  listImagesHandler,
  setImageFavoriteHandler,
} from "./routes/images";
import { startImageJobWatcher } from "./lib/image-jobs";
import { startAudioJobWatcher } from "./lib/audio-jobs";
import { setupHandler, setupStatusHandler } from "./routes/setup";
import { statusHandler } from "./routes/status";

const app = new Hono<AuthEnv>();

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Disposition"],
  }),
);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }

  console.error("[api] unhandled error", error);

  return c.json({ error: "Internal server error" }, 500);
});

const routes = app
  // Better Auth owns everything under /api/auth (sign-in, sign-out, session,
  // admin plugin endpoints, ...).
  .on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  .get("/", (c) => c.text("Hello Hono!"))
  .get("/setup-status", setupStatusHandler)
  .post("/setup", setupHandler)
  .get("/me", requireAuth, meHandler)
  .get("/status", requireAuth, statusHandler)
  .get("/images", requireAuth, requireCapability("image"), listImagesHandler)
  .get("/images/:id", requireAuth, requireCapability("image"), getImageHandler)
  .get(
    "/images/:id/download",
    requireAuth,
    requireCapability("image"),
    downloadImageHandler,
  )
  .patch(
    "/images/:id/favorite",
    requireAuth,
    requireCapability("image"),
    setImageFavoriteHandler,
  )
  .post("/images", requireAuth, requireCapability("image"), createImageHandler)
  .post(
    "/images/cost",
    requireAuth,
    requireCapability("image"),
    estimateImageCostHandler,
  )
  .get(
    "/audio/voices",
    requireAuth,
    requireCapability("audio"),
    listVoicesHandler,
  )
  .get(
    "/audio/voices/preview/audio",
    requireAuth,
    requireCapability("audio"),
    voicePreviewAudioHandler,
  )
  .post(
    "/audio/voices/preview",
    requireAuth,
    requireCapability("audio"),
    voicePreviewHandler,
  )
  .post(
    "/audio/cost",
    requireAuth,
    requireCapability("audio"),
    estimateAudioCostHandler,
  )
  .get("/audio", requireAuth, requireCapability("audio"), listAudioHandler)
  .post("/audio", requireAuth, requireCapability("audio"), createAudioHandler)
  .get(
    "/audio/:id/audio",
    requireAuth,
    requireCapability("audio"),
    audioFileHandler,
  )
  .get("/audio/:id", requireAuth, requireCapability("audio"), getAudioHandler)
  .get("/admin/users", requireAuth, requireAdmin, listUsersHandler)
  .post("/admin/users", requireAuth, requireAdmin, createUserHandler)
  .post(
    "/admin/users/:id/reset-password",
    requireAuth,
    requireAdmin,
    resetPasswordHandler,
  )
  .patch(
    "/admin/users/:id/capabilities",
    requireAuth,
    requireAdmin,
    updateCapabilitiesHandler,
  )
  .post("/admin/users/:id/ban", requireAuth, requireAdmin, banUserHandler)
  .post("/admin/users/:id/unban", requireAuth, requireAdmin, unbanUserHandler)
  .delete("/admin/users/:id", requireAuth, requireAdmin, deleteUserHandler);

// Polls running generations in the background so statuses stay current even
// when no gallery tab is open. Idempotent: repeated imports reuse one timer.
startImageJobWatcher();
startAudioJobWatcher();

export type AppType = typeof routes;
export type {
  HiggsfieldStatus,
  HiggsfieldStatusResponse,
} from "./lib/higgsfield";

export default {
  port: Number(process.env.PORT ?? 5561),
  fetch: routes.fetch,
};
