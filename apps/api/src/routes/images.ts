import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { db } from "../lib/db";
import { imageGeneration, imageGenerationInput } from "../lib/db/schema";
import {
  CostEstimateError,
  createImageJobs,
  estimateImageCost,
  GenerateError,
  getImageJob,
  uploadMedia,
} from "../lib/higgsfield";
import type { HiggsfieldJob, HiggsfieldUpload } from "../lib/higgsfield";
import {
  insertImageGenerations,
  syncImageGeneration,
  syncPendingImagesForUser,
} from "../lib/image-jobs";
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

  // The gallery polls this endpoint while jobs are running, so refreshing
  // pending rows here keeps every open tab current without a separate route.
  await syncPendingImagesForUser(userId);

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
      userId: imageGeneration.userId,
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

  // Pull the latest provider state before answering, so opening a card that
  // just finished does not require waiting for the next gallery poll.
  const synced = await syncImageGeneration(image);

  const inputs = await db
    .select()
    .from(imageGenerationInput)
    .where(eq(imageGenerationInput.generationId, synced.id))
    .orderBy(imageGenerationInput.position);

  return c.json({ image: synced, inputs });
}

const DOWNLOAD_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Streams the finished image back through our origin so the browser saves it
 * instead of opening the provider URL in a tab. The provider CDN usually does
 * not send CORS headers, so a client-side fetch of `resultUrl` cannot work.
 */
export async function downloadImageHandler(c: Context<AuthEnv>) {
  const userId = c.get("user").id;
  const id = c.req.param("id");

  const [image] = await db
    .select({
      id: imageGeneration.id,
      resultUrl: imageGeneration.resultUrl,
      thumbnailUrl: imageGeneration.thumbnailUrl,
    })
    .from(imageGeneration)
    .where(
      and(
        eq(imageGeneration.id, id ?? ""),
        eq(imageGeneration.userId, userId),
        isNull(imageGeneration.deletedAt),
      ),
    )
    .limit(1);

  const source = image?.resultUrl ?? image?.thumbnailUrl;

  if (!image || !source) {
    throw new HTTPException(404, { message: "Image is not ready to download" });
  }

  const upstream = await fetch(source);

  if (!upstream.ok || !upstream.body) {
    throw new HTTPException(502, { message: "Could not fetch the image file" });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/png";
  const extension = DOWNLOAD_EXTENSIONS[contentType.split(";")[0]] ?? "png";
  const filename = `higgs-${image.id.slice(0, 8)}.${extension}`;

  return new Response(upstream.body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Toggles the star on one of the caller's images. The gallery updates
 * optimistically and rolls back if this call fails.
 */
export async function setImageFavoriteHandler(c: Context<AuthEnv>) {
  const userId = c.get("user").id;
  const id = c.req.param("id");

  const body = await c.req.json().catch(() => null);
  const favorite = (body as { favorite?: unknown } | null)?.favorite;

  if (typeof favorite !== "boolean") {
    throw new HTTPException(400, { message: "favorite must be a boolean." });
  }

  const [updated] = await db
    .update(imageGeneration)
    .set({ isFavorite: favorite, updatedAt: new Date() })
    .where(
      and(
        eq(imageGeneration.id, id ?? ""),
        eq(imageGeneration.userId, userId),
        isNull(imageGeneration.deletedAt),
      ),
    )
    .returning({
      id: imageGeneration.id,
      isFavorite: imageGeneration.isFavorite,
    });

  if (!updated) {
    throw new HTTPException(404, { message: "Image not found" });
  }

  return c.json(updated);
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

/** Validates the model-specific flags the prompt bar can send. */
function readExtras(raw: unknown): Record<string, string> {
  const extras: Record<string, string> = {};

  if (raw === undefined || raw === null || raw === "") return extras;

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HTTPException(400, { message: "Invalid extra options." });
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_EXTRA_FLAGS.has(key)) {
      throw new HTTPException(400, { message: `Unknown option "${key}".` });
    }

    const flag = readToken(value, TOKEN_RE, key);

    if (flag) extras[key] = flag;
  }

  return extras;
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

  const extras = readExtras(value.extras);
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

const MAX_REFERENCES = 16;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const DEFAULT_ASPECT_RATIO = "1:1";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;

function readField(
  body: Record<string, string | File | (string | File)[]>,
  name: string,
): string | undefined {
  const raw = body[name];
  const value = Array.isArray(raw) ? raw[0] : raw;

  return typeof value === "string" ? value : undefined;
}

function readFiles(
  body: Record<string, string | File | (string | File)[]>,
  name: string,
): File[] {
  const raw = body[name];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

  return list.filter((entry): entry is File => entry instanceof File);
}

function readExtrasField(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HTTPException(400, { message: "Invalid extra options." });
  }

  return readExtras(parsed);
}

function extensionFor(file: File) {
  return (
    IMAGE_EXTENSIONS[file.type] ??
    (file.name.match(IMAGE_FILE_RE)?.[0]?.toLowerCase() || ".png")
  );
}

/**
 * Creates a generation: uploads any references, enqueues the CLI job(s),
 * records them, and returns the rows so the gallery can show the new cards
 * immediately. Progress after this point comes from polling `generate get`.
 */
export async function createImageHandler(c: Context<AuthEnv>) {
  const userId = c.get("user").id;

  const body = await c.req
    .parseBody({ all: true })
    .catch(() => null as unknown as Record<string, string | File>);

  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid generation request." });
  }

  const model = readToken(readField(body, "model"), MODEL_RE, "model");

  if (!model) {
    throw new HTTPException(400, { message: "Missing model." });
  }

  const prompt = (readField(body, "prompt") ?? "").trim();

  if (prompt.length > PROMPT_MAX) {
    throw new HTTPException(400, { message: "Prompt is too long." });
  }

  const aspectRatio = readToken(
    readField(body, "aspectRatio"),
    RATIO_RE,
    "aspect ratio",
  );
  const resolution = readToken(
    readField(body, "resolution"),
    TOKEN_RE,
    "resolution",
  );
  const quality = readToken(readField(body, "quality"), TOKEN_RE, "quality");
  const extras = readExtrasField(readField(body, "extras"));

  const files = readFiles(body, "references");

  if (files.length > MAX_REFERENCES) {
    throw new HTTPException(400, {
      message: `At most ${MAX_REFERENCES} reference images are allowed.`,
    });
  }

  for (const file of files) {
    const isImage =
      file.type.startsWith("image/") || IMAGE_FILE_RE.test(file.name);

    if (!isImage) {
      throw new HTTPException(400, {
        message: "Reference files must be images.",
      });
    }

    if (file.size === 0) {
      throw new HTTPException(400, {
        message: `"${file.name}" is empty.`,
      });
    }

    if (file.size > MAX_REFERENCE_BYTES) {
      throw new HTTPException(400, {
        message: `"${file.name}" is larger than 20 MB.`,
      });
    }
  }

  let directory: string | undefined;

  try {
    const uploads: HiggsfieldUpload[] = [];

    if (files.length > 0) {
      directory = await mkdtemp(join(tmpdir(), "higgs-images-"));

      for (const [index, file] of files.entries()) {
        const path = join(directory, `reference-${index}${extensionFor(file)}`);
        await writeFile(path, Buffer.from(await file.arrayBuffer()));
        uploads.push(await uploadMedia(path));
      }
    }

    const referenceIds = uploads.map((upload) => upload.id);

    // The estimate is best effort: reference-required models may not price
    // without the media, and a pricing failure must not block generation.
    let creditsCost: number | null = null;

    try {
      creditsCost = await estimateImageCost({
        model,
        aspectRatio,
        resolution,
        quality,
        extras,
        referenceIds,
      });
    } catch {
      creditsCost = null;
    }

    let jobIds: string[];

    try {
      jobIds = await createImageJobs({
        model,
        prompt,
        aspectRatio,
        resolution,
        quality,
        extras,
        referenceIds,
      });
    } catch (error) {
      if (error instanceof GenerateError) {
        throw new HTTPException(400, { message: error.message.slice(0, 300) });
      }

      throw error;
    }

    const jobs = await Promise.all(
      jobIds.map(async (id) => {
        try {
          return { job: await getImageJob(id) };
        } catch {
          // The job exists, we just could not read it yet; polling fills in
          // the dimensions and status on the next pass.
          const fallback: HiggsfieldJob = {
            id,
            job_type: model,
            status: "queued",
            params: {},
          };

          return { job: fallback };
        }
      }),
    );

    const images = await insertImageGenerations({
      userId,
      model,
      prompt,
      aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
      resolution,
      quality,
      creditsCost,
      jobs,
      references: uploads,
    });

    return c.json({ images }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;

    if (error instanceof GenerateError) {
      throw new HTTPException(502, { message: error.message.slice(0, 300) });
    }

    throw error;
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}
