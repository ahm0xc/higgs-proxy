import { and, eq } from "drizzle-orm";

import { db } from "./db";
import { audioVoicePreview } from "./db/schema";
import type { HiggsfieldJob } from "./higgsfield";
import { createImageJobs, getImageJob } from "./higgsfield";
import { isTerminalStatus, mapJobStatus } from "./image-jobs";

export type VoiceType = "preset" | "element";

export type VoicePreviewStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface VoicePreviewRequest {
  voiceId: string;
  voiceType: VoiceType;
  voiceName?: string;
  /** Only TTS models make sense here; anything else falls back to V2. */
  model?: string;
  retry?: boolean;
}

type PreviewRow = typeof audioVoicePreview.$inferSelect;

/**
 * Short sample lines. The picker shows the chosen line while the preview is
 * rendering, so the user knows what they are about to hear. The line is stable
 * per voice so a cached preview always matches the sentence on the card.
 */
const PREVIEW_LINES = [
  "The morning train leaves at seven fifteen, so let's meet by the north entrance.",
  "I've been thinking about that book you lent me; the ending caught me completely off guard.",
  "Thanks for calling. Your appointment is confirmed for Thursday at four o'clock.",
  "Somewhere past the last ridge, the road opens onto a valley that looks almost unreal.",
  "Take a deep breath, slow down, and tell me everything from the beginning.",
];

function hash(value: string): number {
  let result = 0;

  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(result);
}

export function previewSentence(voiceId: string): string {
  return PREVIEW_LINES[hash(voiceId) % PREVIEW_LINES.length] as string;
}

interface PreviewPlan {
  model: string;
  params: Record<string, string>;
}

/**
 * Inworld voices are a fixed enum on its own model; everything else in the
 * voice library is rendered through Text to Speech V2 with the same
 * ElevenLabs engine the default picker uses.
 */
export function previewPlan({
  voiceId,
  voiceType,
  model,
}: Pick<VoicePreviewRequest, "voiceId" | "voiceType" | "model">): PreviewPlan {
  if (model === "inworld_text_to_speech") {
    return {
      model: "inworld_text_to_speech",
      params: { voice: voiceId },
    };
  }

  return {
    model: "text2speech_v2",
    params: {
      variant: "elevenlabs",
      voice_id: voiceId,
      voice_type: voiceType,
    },
  };
}

function readString(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The job params carry the provider's own voice metadata for this voice. */
function voiceMeta(job: HiggsfieldJob) {
  const voice = job.params?.voice;

  if (typeof voice !== "object" || voice === null || Array.isArray(voice)) {
    return {};
  }

  const value = voice as Record<string, unknown>;

  return {
    gender: readString(value, "gender"),
    age: readString(value, "age"),
    thumbnailUrl: readString(value, "thumbnail_url"),
    sourceUrl: readString(value, "source"),
    waveformUrl: readString(value, "waveform_url"),
  };
}

const PREVIEW_SYNC_INTERVAL_MS = 2_000;
const syncing = new Set<string>();

/**
 * Refreshes a pending preview with `generate get`. Failures are logged and the
 * row is returned untouched, so a transient CLI error does not lose the job.
 */
async function syncPreview(row: PreviewRow): Promise<PreviewRow> {
  if (
    isTerminalStatus(row.status) ||
    syncing.has(row.id) ||
    Date.now() - row.updatedAt.getTime() < PREVIEW_SYNC_INTERVAL_MS
  ) {
    return row;
  }

  syncing.add(row.id);

  try {
    const job = await getImageJob(row.providerJobId);
    const status = mapJobStatus(job.status);
    const completed = status === "completed";
    const resultUrl = completed ? (job.result_url ?? null) : null;
    const now = new Date();

    const patch = {
      status: completed && !resultUrl ? "failed" : status,
      resultUrl: resultUrl ?? row.resultUrl,
      error:
        completed && !resultUrl
          ? "The provider finished without returning audio."
          : (job.fail_reason ?? job.error ?? null),
      ...voiceMeta(job),
      updatedAt: now,
      completedAt: completed ? (row.completedAt ?? now) : row.completedAt,
    } satisfies Partial<PreviewRow>;

    await db
      .update(audioVoicePreview)
      .set(patch)
      .where(eq(audioVoicePreview.id, row.id));

    return { ...row, ...patch };
  } catch (error) {
    console.warn(
      `[audio] failed to sync preview job ${row.providerJobId}:`,
      error instanceof Error ? error.message : error,
    );

    return row;
  } finally {
    syncing.delete(row.id);
  }
}

async function findPreview(
  voiceId: string,
  voiceType: string,
): Promise<PreviewRow | undefined> {
  const rows = await db
    .select()
    .from(audioVoicePreview)
    .where(
      and(
        eq(audioVoicePreview.voiceId, voiceId),
        eq(audioVoicePreview.voiceType, voiceType),
      ),
    )
    .limit(1);

  return rows[0];
}

/** Dedupes concurrent requests (two cards opened in two tabs, fast retries). */
const creating = new Map<string, Promise<PreviewRow>>();

async function createPreview(
  input: VoicePreviewRequest,
  voiceName: string,
): Promise<PreviewRow> {
  const key = `${input.voiceType}:${input.voiceId}`;
  const inFlight = creating.get(key);

  if (inFlight) return inFlight;

  const pending = (async () => {
    const plan = previewPlan(input);
    const sentence = previewSentence(input.voiceId);
    const [jobId] = await createImageJobs({
      model: plan.model,
      prompt: sentence,
      extras: plan.params,
    });

    if (!jobId) {
      throw new Error("The provider did not return a preview job id.");
    }

    const now = new Date();
    const existing = await findPreview(input.voiceId, input.voiceType);

    if (existing) {
      const [row] = await db
        .update(audioVoicePreview)
        .set({
          voiceName,
          model: plan.model,
          sentence,
          providerJobId: jobId,
          status: "queued",
          resultUrl: null,
          error: null,
          completedAt: null,
          updatedAt: now,
        })
        .where(eq(audioVoicePreview.id, existing.id))
        .returning();

      return row as PreviewRow;
    }

    const [row] = await db
      .insert(audioVoicePreview)
      .values({
        id: crypto.randomUUID(),
        voiceId: input.voiceId,
        voiceType: input.voiceType,
        voiceName,
        model: plan.model,
        sentence,
        providerJobId: jobId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return row as PreviewRow;
  })().finally(() => {
    creating.delete(key);
  });

  creating.set(key, pending);

  return pending;
}

export interface VoicePreviewView {
  voiceId: string;
  voiceType: string;
  status: VoicePreviewStatus;
  sentence: string;
  /** Same-origin playback path, ready once the preview completes. */
  url: string | null;
  error: string | null;
  jobId: string;
  gender: string | null;
  age: string | null;
  thumbnailUrl: string | null;
}

export function toPreviewView(row: PreviewRow): VoicePreviewView {
  return {
    voiceId: row.voiceId,
    voiceType: row.voiceType,
    status: row.status as VoicePreviewStatus,
    sentence: row.sentence,
    url:
      row.status === "completed" && row.resultUrl
        ? previewAudioPath(row.voiceId, row.voiceType)
        : null,
    error: row.error,
    jobId: row.providerJobId,
    gender: row.gender,
    age: row.age,
    thumbnailUrl: row.thumbnailUrl,
  };
}

export function previewAudioPath(voiceId: string, voiceType: string): string {
  const params = new URLSearchParams({ voiceId, voiceType });

  return `/audio/voices/preview/audio?${params.toString()}`;
}

/**
 * Returns the cached preview for a voice, creating (or retrying) the sample
 * generation when there is nothing usable yet. Pending rows are synced with
 * the CLI on every call, which is what the picker's poll loop relies on.
 */
export async function requestVoicePreview(
  input: VoicePreviewRequest,
): Promise<VoicePreviewView> {
  let row = await findPreview(input.voiceId, input.voiceType);

  if (row && row.status !== "completed") {
    row = await syncPreview(row);
  }

  if (row && row.status === "completed" && row.resultUrl) {
    return toPreviewView(row);
  }

  const failed = row !== undefined && isTerminalStatus(row.status);

  if (row && failed && !input.retry) {
    return toPreviewView(row);
  }

  if (!row || failed) {
    row = await createPreview(input, input.voiceName?.trim() || input.voiceId);

    return toPreviewView(row);
  }

  return toPreviewView(row);
}

export async function getPreviewRow(
  voiceId: string,
  voiceType: string,
): Promise<PreviewRow | undefined> {
  return findPreview(voiceId, voiceType);
}
