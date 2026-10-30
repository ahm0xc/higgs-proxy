import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../lib/db";
import { imageGeneration, imageGenerationInput } from "../lib/db/schema";
import { CostEstimateError, estimateImageCost } from "../lib/higgsfield";
import type { AuthEnv } from "../middleware/auth";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  const value = Number(raw ?? DEFAULT_LIMIT);

  if (!Number.isFinite(value)) return DEFAULT_LIMIT;

  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

/**
 * The gallery feed for the signed-in user. Newest first, soft-deleted rows
 * hidden. Cursor is the `createdAt` (ms) of the last row of the previous page.
 */
export async function listImagesHandler(c: Context<AuthEnv>) {
  const userId = c.get("user").id;
  const limit = parseLimit(c.req.query("limit"));
  const status = c.req.query("status");
  const favorite = c.req.query("favorite") === "true";
  const cursor = Number(c.req.query("cursor") ?? "");

  const filters = [
    eq(imageGeneration.userId, userId),
    isNull(imageGeneration.deletedAt),
  ];

  if (status) filters.push(eq(imageGeneration.status, status));
  if (favorite) filters.push(eq(imageGeneration.isFavorite, true));
  if (Number.isFinite(cursor) && cursor > 0) {
    filters.push(lt(imageGeneration.createdAt, new Date(cursor)));
  }

  const rows = await db
    .select({
      id: imageGeneration.id,
      model: imageGeneration.model,
      modelName: imageGeneration.modelName,
      prompt: imageGeneration.prompt,
      aspectRatio: imageGeneration.aspectRatio,
      width: imageGeneration.width,
      height: imageGeneration.height,
      resolution: imageGeneration.resolution,
      quality: imageGeneration.quality,
      status: imageGeneration.status,
      progress: imageGeneration.progress,
      resultUrl: imageGeneration.resultUrl,
      thumbnailUrl: imageGeneration.thumbnailUrl,
      error: imageGeneration.error,
      creditsCost: imageGeneration.creditsCost,
      isFavorite: imageGeneration.isFavorite,
      createdAt: imageGeneration.createdAt,
      completedAt: imageGeneration.completedAt,
    })
    .from(imageGeneration)
    .where(and(...filters))
    .orderBy(desc(imageGeneration.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return c.json({
    images: page,
    nextCursor: rows.length > limit && last ? last.createdAt.getTime() : null,
  });
}

/** Full row plus its reference inputs. */
export async function getImageHandler(c: Context<AuthEnv>) {
  const userId = c.get("user").id;
  const id = c.req.param("id");

  const [image] = await db
    .select()
    .from(imageGeneration)
    .where(
      and(
        eq(imageGeneration.id, id ?? ""),
        eq(imageGeneration.userId, userId),
        isNull(imageGeneration.deletedAt),
      ),
    )
    .limit(1);

  if (!image) {
    throw new HTTPException(404, { message: "Image not found" });
  }

  const inputs = await db
    .select()
    .from(imageGenerationInput)
    .where(eq(imageGenerationInput.generationId, image.id))
    .orderBy(imageGenerationInput.position);

  return c.json({ image, inputs });
}

/**
 * Credit estimate for the prompt bar's current settings. Priced by the CLI
 * without creating a job, and cached briefly because the bar re-estimates as
 * the user changes options.
 */

const ALLOWED_EXTRA_FLAGS = new Set([
  "variant",
  "background",
  "thinking",
  "batch_size",
  "model_type",
  "mode",
]);

const MODEL_RE = /^[a-z0-9_]{1,64}$/;
const TOKEN_RE = /^[a-z0-9_.]{1,32}$/i;
const RATIO_RE = /^(auto|\d{1,3}:\d{1,3})$/;
const PROMPT_MAX = 4000;
const COST_CACHE_TTL_MS = 5 * 60 * 1000;
const COST_CACHE_MAX = 200;

const costCache = new Map<string, { credits: number; expiresAt: number }>();

function readToken(
  value: unknown,
  pattern: RegExp,
  name: string,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value !== "string" || !pattern.test(value)) {
    throw new HTTPException(400, { message: `Invalid ${name}.` });
  }

  return value;
}

export async function estimateImageCostHandler(c: Context<AuthEnv>) {
  const body: unknown = await c.req.json().catch(() => null);

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HTTPException(400, { message: "Invalid cost request." });
  }

  const value = body as Record<string, unknown>;
  const model = readToken(value.model, MODEL_RE, "model");

  if (!model) {
    throw new HTTPException(400, { message: "Missing model." });
  }

  const aspectRatio = readToken(value.aspectRatio, RATIO_RE, "aspect ratio");
  const resolution = readToken(value.resolution, TOKEN_RE, "resolution");
  const quality = readToken(value.quality, TOKEN_RE, "quality");

  if (value.prompt !== undefined && typeof value.prompt !== "string") {
    throw new HTTPException(400, { message: "Invalid prompt." });
  }

  if (typeof value.prompt === "string" && value.prompt.length > PROMPT_MAX) {
    throw new HTTPException(400, { message: "Prompt is too long." });
  }

  const extras: Record<string, string> = {};
  const rawExtras = value.extras;

  if (rawExtras !== undefined) {
    if (
      typeof rawExtras !== "object" ||
      rawExtras === null ||
      Array.isArray(rawExtras)
    ) {
      throw new HTTPException(400, { message: "Invalid extra options." });
    }

    for (const [key, raw] of Object.entries(rawExtras)) {
      if (!ALLOWED_EXTRA_FLAGS.has(key)) {
        throw new HTTPException(400, { message: `Unknown option "${key}".` });
      }

      const flag = readToken(raw, TOKEN_RE, key);

      if (flag) extras[key] = flag;
    }
  }

  const key = JSON.stringify([model, aspectRatio, resolution, quality, extras]);
  const cached = costCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return c.json({ credits: cached.credits });
  }

  try {
    const credits = await estimateImageCost({
      model,
      aspectRatio,
      resolution,
      quality,
      extras,
    });

    if (costCache.size >= COST_CACHE_MAX) {
      const oldest = costCache.keys().next().value;
      if (oldest !== undefined) costCache.delete(oldest);
    }

    costCache.set(key, {
      credits,
      expiresAt: Date.now() + COST_CACHE_TTL_MS,
    });

    return c.json({ credits });
  } catch (error) {
    if (error instanceof CostEstimateError) {
      throw new HTTPException(502, {
        message: error.message.slice(0, 300),
      });
    }

    throw new HTTPException(503, {
      message: "The Higgsfield CLI is unavailable.",
    });
  }
}
