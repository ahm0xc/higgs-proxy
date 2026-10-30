import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../lib/db";
import { imageGeneration, imageGenerationInput } from "../lib/db/schema";
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
