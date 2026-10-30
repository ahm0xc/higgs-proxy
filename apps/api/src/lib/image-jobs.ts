import { and, eq, inArray } from "drizzle-orm";

import { db } from "./db";
import { imageGeneration, imageGenerationInput } from "./db/schema";
import type { HiggsfieldJob, HiggsfieldUpload } from "./higgsfield";
import { getImageJob } from "./higgsfield";

export type ImageJobStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

type ImageRow = typeof imageGeneration.$inferSelect;

const TERMINAL_STATUSES: ImageJobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as string[]).includes(status);
}

/**
 * The CLI reports a wider vocabulary than the gallery knows about
 * (`in_progress`, `nsfw`, `not_found`, ...), so collapse it to the five
 * states the UI renders.
 */
export function mapJobStatus(status: string): ImageJobStatus {
  switch (status.toLowerCase()) {
    case "completed":
    case "succeeded":
    case "success":
      return "completed";
    case "failed":
    case "error":
    case "nsfw":
    case "not_found":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "in_progress":
    case "processing":
    case "running":
    case "waiting":
      return "processing";
    default:
      return "queued";
  }
}

function readNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;

  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? Math.round(number)
    : undefined;
}

function fallbackDimensions(aspectRatio: string): {
  width: number;
  height: number;
} {
  const [rawWidth, rawHeight] = aspectRatio.split(":").map(Number);
  const width = Number.isFinite(rawWidth) ? rawWidth : 1;
  const height = Number.isFinite(rawHeight) ? rawHeight : 1;

  if (width >= height) {
    return { width: 1024, height: Math.round((1024 * height) / width) };
  }

  return { width: Math.round((1024 * width) / height), height: 1024 };
}

/** Width/height come back from the job params once the provider reports them. */
export function jobDimensions(
  job: Pick<HiggsfieldJob, "params">,
  aspectRatio: string,
) {
  const params = job.params ?? {};

  return {
    width: readNumber(params.width) ?? fallbackDimensions(aspectRatio).width,
    height: readNumber(params.height) ?? fallbackDimensions(aspectRatio).height,
  };
}

function jobError(job: HiggsfieldJob): string | null {
  for (const candidate of [job.fail_reason, job.error]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 500);
    }
  }

  if (mapJobStatus(job.status) === "failed") {
    return "The provider did not return a result for this generation.";
  }

  return null;
}

function readParamString(
  params: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = params?.[key];

  return typeof value === "string" && value ? value : null;
}

export interface NewImageRow {
  userId: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  quality?: string;
  creditsCost?: number | null;
}

/**
 * Persists one row per provider job (a batch creates several), plus its
 * reference inputs. The job fields are authoritative for dimensions and
 * status, so a fast job does not sit at "queued" until the first poll.
 */
export async function insertImageGenerations({
  userId,
  model,
  prompt,
  aspectRatio,
  resolution,
  quality,
  creditsCost,
  jobs,
  references,
}: NewImageRow & {
  jobs: { job: HiggsfieldJob; fallbackStatus?: ImageJobStatus }[];
  references: HiggsfieldUpload[];
}): Promise<ImageRow[]> {
  const now = new Date();
  // Stored per image, since one batch job can fan out into several rows.
  const perImageCredits =
    typeof creditsCost === "number" && jobs.length > 0
      ? Math.round((creditsCost / jobs.length) * 100) / 100
      : null;

  const rows: ImageRow[] = [];

  for (const { job, fallbackStatus } of jobs) {
    const status =
      job.status !== undefined
        ? mapJobStatus(job.status)
        : (fallbackStatus ?? "queued");
    const dimensions = jobDimensions(job, aspectRatio);
    const completed = status === "completed";

    const [row] = await db
      .insert(imageGeneration)
      .values({
        id: crypto.randomUUID(),
        userId,
        providerJobId: job.id,
        model: job.job_type || model,
        modelName: job.display_name || model,
        prompt,
        aspectRatio: readParamString(job.params, "aspect_ratio") ?? aspectRatio,
        width: dimensions.width,
        height: dimensions.height,
        resolution: readParamString(job.params, "resolution") ?? resolution,
        quality: readParamString(job.params, "quality") ?? quality,
        status,
        progress: completed ? 100 : 0,
        resultUrl: job.result_url ?? null,
        thumbnailUrl: job.min_result_url ?? job.result_url ?? null,
        error: jobError(job),
        params: (job.params ?? null) as Record<string, unknown> | null,
        creditsCost: perImageCredits,
        createdAt: job.created_at ? new Date(job.created_at) : now,
        updatedAt: now,
        completedAt: completed ? now : null,
      })
      .returning();

    if (row && references.length > 0) {
      await db.insert(imageGenerationInput).values(
        references.map((upload, position) => ({
          id: crypto.randomUUID(),
          generationId: row.id,
          role: "reference",
          position,
          uploadId: upload.id,
          url: upload.url,
          createdAt: now,
        })),
      );
    }

    if (row) rows.push(row);
  }

  return rows;
}

const syncing = new Set<string>();
const SYNC_MIN_INTERVAL_MS = 2_000;

/**
 * Refreshes one row from `generate get`. Returns the current row, untouched
 * when it is already terminal or was polled moments ago.
 */
export async function syncImageGeneration(row: ImageRow): Promise<ImageRow> {
  if (
    !row.providerJobId ||
    isTerminalStatus(row.status) ||
    syncing.has(row.id) ||
    Date.now() - row.updatedAt.getTime() < SYNC_MIN_INTERVAL_MS
  ) {
    return row;
  }

  syncing.add(row.id);

  try {
    const job = await getImageJob(row.providerJobId);
    const status = mapJobStatus(job.status);
    const dimensions = jobDimensions(job, row.aspectRatio);
    const now = new Date();
    const completed = status === "completed";

    const patch = {
      modelName: job.display_name || row.modelName,
      status,
      progress: completed ? 100 : row.progress,
      width: dimensions.width,
      height: dimensions.height,
      resultUrl: job.result_url ?? row.resultUrl,
      thumbnailUrl:
        job.min_result_url ?? job.result_url ?? row.thumbnailUrl ?? null,
      error: jobError(job),
      params: (job.params ?? row.params) as Record<string, unknown> | null,
      updatedAt: now,
      completedAt: completed ? (row.completedAt ?? now) : row.completedAt,
    } satisfies Partial<ImageRow>;

    await db
      .update(imageGeneration)
      .set(patch)
      .where(eq(imageGeneration.id, row.id));

    return { ...row, ...patch };
  } catch (error) {
    console.warn(
      `[images] failed to sync job ${row.providerJobId}:`,
      error instanceof Error ? error.message : error,
    );

    return row;
  } finally {
    syncing.delete(row.id);
  }
}

/** Polls every non-terminal image of this user (used by the gallery). */
export async function syncPendingImagesForUser(userId: string): Promise<void> {
  const rows = await db
    .select()
    .from(imageGeneration)
    .where(
      and(
        eq(imageGeneration.userId, userId),
        inArray(imageGeneration.status, ["queued", "processing"]),
      ),
    )
    .limit(30);

  await Promise.all(rows.map((row) => syncImageGeneration(row)));
}

/**
 * Keeps jobs moving even when nobody has the gallery open. Runs in-process on
 * an interval; the guard keeps `bun --hot` reloads from stacking timers.
 */
export async function syncActiveImageJobs(): Promise<void> {
  const rows = await db
    .select()
    .from(imageGeneration)
    .where(inArray(imageGeneration.status, ["queued", "processing"]))
    .limit(25);

  await Promise.all(rows.map((row) => syncImageGeneration(row)));
}

const WATCH_INTERVAL_MS = Number(
  process.env.IMAGE_JOB_POLL_INTERVAL_MS ?? 4_000,
);

export function startImageJobWatcher(): void {
  const scope = globalThis as typeof globalThis & {
    __higgsImageJobWatcher?: ReturnType<typeof setInterval>;
  };

  if (scope.__higgsImageJobWatcher) return;

  const timer = setInterval(() => {
    void syncActiveImageJobs().catch((error) => {
      console.warn(
        "[images] job watcher failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, WATCH_INTERVAL_MS);

  // Never keep the process alive just for polling.
  timer.unref?.();

  scope.__higgsImageJobWatcher = timer;
}
