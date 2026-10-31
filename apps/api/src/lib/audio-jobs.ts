import { and, eq, inArray } from "drizzle-orm";

import { db } from "./db";
import { audioGeneration } from "./db/schema";
import type { HiggsfieldJob } from "./higgsfield";
import { getImageJob } from "./higgsfield";
import { isTerminalStatus, mapJobStatus } from "./image-jobs";

export type AudioJobStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export type AudioRow = typeof audioGeneration.$inferSelect;

function readString(
  source: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = source?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The provider echoes its own voice record back in the job params. */
function voiceMeta(job: HiggsfieldJob) {
  const voice = job.params?.voice;

  if (typeof voice !== "object" || voice === null || Array.isArray(voice)) {
    return {};
  }

  const value = voice as Record<string, unknown>;

  return {
    name: readString(value, "name"),
    gender: readString(value, "gender"),
    age: readString(value, "age"),
    thumbnailUrl: readString(value, "thumbnail_url"),
    waveformUrl: readString(value, "waveform_url"),
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

export interface NewAudioRow {
  userId: string;
  model: string;
  prompt: string;
  variant?: string | null;
  voiceId?: string | null;
  voiceType?: string | null;
  voiceName?: string | null;
  params: Record<string, string>;
  creditsCost?: number | null;
}

/**
 * Persists one row per provider job. A batch submission (Qwen's `batch_size`)
 * creates several rows, so the estimate is split evenly between them.
 */
export async function insertAudioGenerations({
  userId,
  model,
  prompt,
  variant,
  voiceId,
  voiceType,
  voiceName,
  params,
  creditsCost,
  jobs,
}: NewAudioRow & {
  jobs: { job: HiggsfieldJob; fallbackStatus?: AudioJobStatus }[];
}): Promise<AudioRow[]> {
  const now = new Date();
  const perJobCredits =
    typeof creditsCost === "number" && jobs.length > 0
      ? Math.round((creditsCost / jobs.length) * 100) / 100
      : null;

  const rows: AudioRow[] = [];

  for (const { job, fallbackStatus } of jobs) {
    const status =
      job.status !== undefined
        ? mapJobStatus(job.status)
        : (fallbackStatus ?? "queued");
    const completed = status === "completed";
    const resultUrl = job.result_url ?? null;
    const meta = voiceMeta(job);

    const [row] = await db
      .insert(audioGeneration)
      .values({
        id: crypto.randomUUID(),
        userId,
        providerJobId: job.id,
        model: job.job_type || model,
        modelName: job.display_name || model,
        prompt,
        variant: variant ?? null,
        voiceId: voiceId ?? null,
        voiceType: voiceType ?? null,
        voiceName: meta.name ?? voiceName ?? voiceId ?? null,
        status: completed && !resultUrl ? "failed" : status,
        resultUrl,
        error:
          completed && !resultUrl
            ? "The provider finished without returning audio."
            : jobError(job),
        params,
        creditsCost: perJobCredits,
        voiceGender: meta.gender ?? null,
        voiceAge: meta.age ?? null,
        voiceThumbnailUrl: meta.thumbnailUrl ?? null,
        voiceWaveformUrl: meta.waveformUrl ?? null,
        createdAt: job.created_at ? new Date(job.created_at) : now,
        updatedAt: now,
        completedAt: completed ? now : null,
      })
      .returning();

    if (row) rows.push(row);
  }

  return rows;
}

const syncing = new Set<string>();
const SYNC_MIN_INTERVAL_MS = 2_000;

/**
 * Refreshes one row from `generate get`. Terminal rows and rows polled moments
 * ago are returned untouched; a transient CLI error leaves the row as-is.
 */
export async function syncAudioGeneration(row: AudioRow): Promise<AudioRow> {
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
    const completed = status === "completed";
    const resultUrl = completed ? (job.result_url ?? null) : null;
    const meta = voiceMeta(job);
    const now = new Date();

    const patch = {
      modelName: job.display_name || row.modelName,
      status: completed && !resultUrl ? "failed" : status,
      resultUrl: resultUrl ?? row.resultUrl,
      error:
        completed && !resultUrl
          ? "The provider finished without returning audio."
          : (job.fail_reason ?? job.error ?? row.error),
      voiceName: meta.name ?? row.voiceName,
      voiceGender: meta.gender ?? row.voiceGender,
      voiceAge: meta.age ?? row.voiceAge,
      voiceThumbnailUrl: meta.thumbnailUrl ?? row.voiceThumbnailUrl,
      voiceWaveformUrl: meta.waveformUrl ?? row.voiceWaveformUrl,
      updatedAt: now,
      completedAt: completed ? (row.completedAt ?? now) : row.completedAt,
    } satisfies Partial<AudioRow>;

    await db
      .update(audioGeneration)
      .set(patch)
      .where(eq(audioGeneration.id, row.id));

    return { ...row, ...patch };
  } catch (error) {
    console.warn(
      `[audio] failed to sync job ${row.providerJobId}:`,
      error instanceof Error ? error.message : error,
    );

    return row;
  } finally {
    syncing.delete(row.id);
  }
}

/** Polls every non-terminal audio generation of this user (used by the list). */
export async function syncPendingAudioForUser(userId: string): Promise<void> {
  const rows = await db
    .select()
    .from(audioGeneration)
    .where(
      and(
        eq(audioGeneration.userId, userId),
        inArray(audioGeneration.status, ["queued", "processing"]),
      ),
    )
    .limit(30);

  await Promise.all(rows.map((row) => syncAudioGeneration(row)));
}

/** Keeps jobs moving while nobody has the audio page open. */
export async function syncActiveAudioJobs(): Promise<void> {
  const rows = await db
    .select()
    .from(audioGeneration)
    .where(inArray(audioGeneration.status, ["queued", "processing"]))
    .limit(25);

  await Promise.all(rows.map((row) => syncAudioGeneration(row)));
}

const WATCH_INTERVAL_MS = Number(
  process.env.AUDIO_JOB_POLL_INTERVAL_MS ?? 4_000,
);

export function startAudioJobWatcher(): void {
  const scope = globalThis as typeof globalThis & {
    __higgsAudioJobWatcher?: ReturnType<typeof setInterval>;
  };

  if (scope.__higgsAudioJobWatcher) return;

  const timer = setInterval(() => {
    void syncActiveAudioJobs().catch((error) => {
      console.warn(
        "[audio] job watcher failed:",
        error instanceof Error ? error.message : error,
      );
    });
  }, WATCH_INTERVAL_MS);

  // Never keep the process alive just for polling.
  timer.unref?.();

  scope.__higgsAudioJobWatcher = timer;
}
