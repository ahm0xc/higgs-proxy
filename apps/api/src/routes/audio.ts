import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  CostEstimateError,
  estimateAudioCost,
  GenerateError,
  listVoices,
} from "../lib/higgsfield";
import { getPreviewRow, requestVoicePreview } from "../lib/audio-preview";
import type { VoicePreviewRequest } from "../lib/audio-preview";
import type { AuthEnv } from "../middleware/auth";

/**
 * The CLI rejects a cost request that is missing required params, but the
 * prompt bar asks for a price before the voice library has loaded. These
 * placeholders satisfy validation; the price does not depend on the voice.
 */
const PLACEHOLDER_VOICE_ID = "00000000-0000-0000-0000-000000000000";

interface AudioModelRules {
  /** Flags the prompt bar may send for this model. */
  allowed: Set<string>;
  /** Filled in when the bar has not picked a value yet. */
  defaults: Record<string, string>;
}

const AUDIO_MODELS: Record<string, AudioModelRules> = {
  text2speech_v2: {
    allowed: new Set(["variant", "voice_id", "voice_type"]),
    defaults: {
      variant: "elevenlabs",
      voice_id: PLACEHOLDER_VOICE_ID,
      voice_type: "preset",
    },
  },
  inworld_text_to_speech: {
    allowed: new Set(["voice"]),
    defaults: { voice: "Loretta (en)" },
  },
  qwen_audio_tts: {
    allowed: new Set([
      "batch_size",
      "format",
      "instruction",
      "language",
      "pitch_rate",
      "sample_rate",
      "seed",
      "speech_rate",
      "voice_id",
      "voice_type",
      "volume",
    ]),
    defaults: { voice_id: PLACEHOLDER_VOICE_ID, voice_type: "preset" },
  },
  seed_audio: {
    allowed: new Set([
      "format",
      "loudness_rate",
      "pitch_rate",
      "sample_rate",
      "speech_rate",
      "voice_id",
      "voice_type",
    ]),
    defaults: {},
  },
};

const PROMPT_MAX = 15_000;
const PARAM_MAX = 2_000;
const VOICE_ID_MAX = 200;
const PREVIEW_MODELS = new Set(["text2speech_v2", "inworld_text_to_speech"]);
const COST_CACHE_TTL_MS = 5 * 60 * 1000;
const COST_CACHE_MAX = 200;
const VOICES_CACHE_TTL_MS = 5 * 60 * 1000;

const costCache = new Map<string, { credits: number; expiresAt: number }>();

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error ?? "");

  const cause = (error as { cause?: unknown }).cause;

  return cause instanceof Error
    ? `${error.message} ${cause.message}`
    : error.message;
}

function fail(error: unknown, fallback: string): never {
  console.error(`[audio] ${fallback}`, error);

  if (error instanceof HTTPException) {
    throw error;
  }

  if (error instanceof CostEstimateError || error instanceof GenerateError) {
    throw new HTTPException(502, { message: error.message });
  }

  // The preview table ships with a migration the operator applies manually.
  // Without it, every query fails with a generic SQLite error.
  if (/no such table/i.test(errorText(error))) {
    throw new HTTPException(503, {
      message:
        "Voice preview storage is not ready. Apply the audio_voice_preview database migration, then try again.",
    });
  }

  throw new HTTPException(502, { message: fallback });
}

/** The workspace voice library for the prompt bar's voice picker. */
let voicesCache:
  | { expiresAt: number; value: Awaited<ReturnType<typeof listVoices>> }
  | undefined;

export async function listVoicesHandler(c: Context<AuthEnv>) {
  if (voicesCache && voicesCache.expiresAt > Date.now()) {
    return c.json({ voices: voicesCache.value });
  }

  try {
    const voices = await listVoices();

    voicesCache = {
      value: voices,
      expiresAt: Date.now() + VOICES_CACHE_TTL_MS,
    };

    return c.json({ voices });
  } catch (error) {
    return fail(error, "Could not read the voice library.");
  }
}

function readVoiceField(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > VOICE_ID_MAX ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new HTTPException(400, { message: `Invalid ${name}.` });
  }

  return value;
}

function readVoiceType(value: unknown): "preset" | "element" {
  if (value !== "preset" && value !== "element") {
    throw new HTTPException(400, { message: "Invalid voice type." });
  }

  return value;
}

/**
 * Returns the cached sample for a voice, or starts one. The picker polls this
 * while the card shows "Generating…"; the row keeps the provider job id so a
 * finished preview is played straight from cache on later opens.
 */
export async function voicePreviewHandler(c: Context<AuthEnv>) {
  const body: unknown = await c.req.json().catch(() => null);

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HTTPException(400, { message: "Invalid preview request." });
  }

  const value = body as Record<string, unknown>;
  const model = value.model;

  if (
    model !== undefined &&
    (typeof model !== "string" || !PREVIEW_MODELS.has(model))
  ) {
    throw new HTTPException(400, { message: "Invalid preview model." });
  }

  if (value.retry !== undefined && typeof value.retry !== "boolean") {
    throw new HTTPException(400, { message: "Invalid retry flag." });
  }

  if (
    value.voiceName !== undefined &&
    (typeof value.voiceName !== "string" || value.voiceName.length > 100)
  ) {
    throw new HTTPException(400, { message: "Invalid voice name." });
  }

  const request: VoicePreviewRequest = {
    voiceId: readVoiceField(value.voiceId, "voice id"),
    voiceType: readVoiceType(value.voiceType),
    ...(typeof value.voiceName === "string"
      ? { voiceName: value.voiceName }
      : {}),
    ...(typeof model === "string" ? { model } : {}),
    ...(value.retry === true ? { retry: true } : {}),
  };

  try {
    const preview = await requestVoicePreview(request);

    return c.json({ preview });
  } catch (error) {
    return fail(error, "Could not prepare the voice preview.");
  }
}

/**
 * Streams a finished preview through our origin. This keeps the provider CDN's
 * missing CORS headers out of the way, so the picker can decode the audio and
 * draw a real waveform from it.
 */
export async function voicePreviewAudioHandler(c: Context<AuthEnv>) {
  const voiceId = readVoiceField(c.req.query("voiceId"), "voice id");
  const voiceType = readVoiceType(c.req.query("voiceType"));
  const row = await getPreviewRow(voiceId, voiceType);

  if (!row || row.status !== "completed" || !row.resultUrl) {
    throw new HTTPException(404, { message: "Voice preview is not ready." });
  }

  const range = c.req.header("range");
  const upstream = await fetch(row.resultUrl, {
    headers: range ? { range } : {},
  });

  if (!upstream.ok || !upstream.body) {
    throw new HTTPException(502, {
      message: "Could not fetch the voice preview.",
    });
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
    "cache-control": "private, max-age=86400",
    "accept-ranges": upstream.headers.get("accept-ranges") ?? "bytes",
  });
  const contentLength = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");

  if (contentLength) headers.set("content-length", contentLength);
  if (contentRange) headers.set("content-range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

function readParamValue(key: string, value: unknown): string {
  if (typeof value !== "string" || value.length > PARAM_MAX) {
    throw new HTTPException(400, { message: `Invalid "${key}" value.` });
  }

  return value;
}

/**
 * Credit estimate for the prompt bar's current script and settings. A
 * text-to-speech job is priced by character count, so this re-runs whenever
 * the script changes.
 */
export async function estimateAudioCostHandler(c: Context<AuthEnv>) {
  const body: unknown = await c.req.json().catch(() => null);

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HTTPException(400, { message: "Invalid cost request." });
  }

  const value = body as Record<string, unknown>;
  const model = value.model;

  if (typeof model !== "string" || !(model in AUDIO_MODELS)) {
    throw new HTTPException(400, { message: "Unknown audio model." });
  }

  const rules = AUDIO_MODELS[model] as AudioModelRules;

  if (typeof value.prompt !== "string") {
    throw new HTTPException(400, { message: "Invalid prompt." });
  }

  if (value.prompt.length > PROMPT_MAX) {
    throw new HTTPException(400, { message: "Prompt is too long." });
  }

  if (
    value.params !== undefined &&
    (typeof value.params !== "object" ||
      value.params === null ||
      Array.isArray(value.params))
  ) {
    throw new HTTPException(400, { message: "Invalid audio options." });
  }

  const params: Record<string, string> = { ...rules.defaults };

  for (const [key, raw] of Object.entries(
    (value.params as Record<string, unknown> | undefined) ?? {},
  )) {
    if (!rules.allowed.has(key)) {
      throw new HTTPException(400, { message: `Unknown option "${key}".` });
    }

    const parsed = readParamValue(key, raw);

    if (parsed !== "") params[key] = parsed;
  }

  const key = JSON.stringify([model, value.prompt, params]);
  const cached = costCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return c.json({ credits: cached.credits });
  }

  try {
    const credits = await estimateAudioCost({
      model,
      prompt: value.prompt,
      params,
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
    return fail(error, "Could not estimate the cost.");
  }
}
