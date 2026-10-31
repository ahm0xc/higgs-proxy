import { apiBaseUrl } from "./api";
import { requestJson } from "./request";

export type VoiceType = "preset" | "element";

export interface AudioVoice {
  id: string;
  name: string;
  type: VoiceType;
  createdAt: string;
}

export interface VoiceListResponse {
  voices: AudioVoice[];
}

/**
 * The workspace voice library from `higgsfield voices list`. Cached on the
 * client so switching models (or closing and reopening the bar) does not
 * re-query the CLI.
 */
let voicesPromise: Promise<AudioVoice[]> | null = null;

export function listVoices(force = false): Promise<AudioVoice[]> {
  if (!force && voicesPromise) return voicesPromise;

  const pending = requestJson<VoiceListResponse>("/audio/voices")
    .then((result) => result.voices)
    .catch((error) => {
      // Let the next open retry instead of caching a failure forever.
      voicesPromise = null;
      throw error;
    });

  voicesPromise = pending;

  return pending;
}

export interface AudioCostInput {
  model: string;
  prompt: string;
  /** Verbatim CLI flags: variant, voice_id, voice_type, language, ... */
  params: Record<string, string>;
}

/** Estimated credits for one text-to-speech job, priced by the CLI. */
export function estimateAudioCost(
  input: AudioCostInput,
  init: RequestInit = {},
) {
  return requestJson<{ credits: number }>("/audio/cost", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });
}

export type VoicePreviewStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface VoicePreview {
  voiceId: string;
  voiceType: string;
  status: VoicePreviewStatus;
  sentence: string;
  /** Same-origin playback path, present once the preview is ready. */
  url: string | null;
  error: string | null;
  jobId: string;
  gender: string | null;
  age: string | null;
  thumbnailUrl: string | null;
}

export interface VoicePreviewInput {
  voiceId: string;
  voiceType: VoiceType;
  voiceName?: string;
  /** `text2speech_v2` for the shared library, Inworld for its fixed voices. */
  model?: string;
  retry?: boolean;
}

/**
 * Returns the cached sample for a voice or starts one. Calling it again while
 * the preview is rendering also refreshes its status, which is what the card's
 * poll loop does.
 */
export function requestVoicePreview(input: VoicePreviewInput) {
  return requestJson<{ preview: VoicePreview }>("/audio/voices/preview", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((result) => result.preview);
}

/** Absolute same-origin URL for an `<audio>` element / fetch + decode. */
export function voicePreviewAudioUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}
