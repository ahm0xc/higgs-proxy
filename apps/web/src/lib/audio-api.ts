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

export type AudioGenerationStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface AudioGeneration {
  id: string;
  userId: string;
  userName: string | null;
  providerJobId?: string | null;
  model: string;
  modelName: string;
  prompt: string;
  variant: string | null;
  voiceId: string | null;
  voiceType: string | null;
  voiceName: string | null;
  status: AudioGenerationStatus;
  resultUrl: string | null;
  error: string | null;
  params: Record<string, string> | null;
  creditsCost: number | null;
  durationSeconds: number | null;
  voiceGender: string | null;
  voiceAge: string | null;
  voiceThumbnailUrl: string | null;
  voiceWaveformUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AudioListResponse {
  audio: AudioGeneration[];
  nextCursor: number | null;
}

/** Newest first. The API refreshes pending jobs before answering. */
export function listAudioGenerations(limit = 60) {
  return requestJson<AudioListResponse>(`/audio?limit=${limit}`);
}

export interface CreateAudioInput {
  model: string;
  prompt: string;
  /** Verbatim CLI flags: variant, voice_id, voice_type, language, ... */
  params: Record<string, string>;
  voiceName?: string;
}

/** Enqueues the text-to-speech job; returns the fresh rows to show at once. */
export function createAudioGeneration(input: CreateAudioInput) {
  return requestJson<{ audio: AudioGeneration[] }>("/audio", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Same-origin streaming endpoint, used by the list player. */
export function audioPlaybackUrl(id: string) {
  return `${apiBaseUrl}/audio/${id}/audio`;
}

/** Same-origin attachment endpoint for the download button. */
export function audioDownloadUrl(id: string) {
  return `${apiBaseUrl}/audio/${id}/audio?download=1`;
}
