/**
 * Shared waveform helpers for the voice picker and the audio list.
 *
 * Peaks come from decoding the real file with the Web Audio API, so bars match
 * the audio the user actually hears. `fallbackPeaks` draws a deterministic
 * stand-in while the decode is in flight (or if it fails).
 */

export const WAVE_BARS = 44;

export function hashString(value: string): number {
  let result = 0;

  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(result);
}

/** Deterministic stand-in bars shown before the real waveform is decoded. */
export function fallbackPeaks(seed: string): number[] {
  let state = hashString(seed) || 1;

  return Array.from({ length: WAVE_BARS }, (_, index) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;

    const noise = 0.2 + ((state % 1000) / 1000) * 0.8;
    const envelope = 0.55 + 0.45 * Math.sin((index / WAVE_BARS) * Math.PI * 3);

    return Math.min(1, Math.max(0.12, noise * envelope));
  });
}

/** Decoded peaks per URL, shared by every consumer that renders it. */
const peaksCache = new Map<string, number[]>();
/** Decoded duration (seconds) per URL, filled while decoding the waveform. */
const durationCache = new Map<string, number>();

export function durationOf(url: string): number | null {
  const value = durationCache.get(url);

  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export async function decodePeaks(url: string): Promise<number[] | null> {
  const cached = peaksCache.get(url);
  if (cached) return cached;

  try {
    const response = await fetch(url, { credentials: "include" });

    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const context = new AudioContext();
    const audio = await context.decodeAudioData(buffer);
    const channel = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / WAVE_BARS));
    const peaks = Array.from({ length: WAVE_BARS }, (_, index) => {
      let peak = 0;
      const start = index * block;

      for (let sample = start; sample < start + block; sample += 1) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
      }

      return peak;
    });
    const loudest = Math.max(...peaks, 0.0001);
    const normalized = peaks.map((peak) =>
      Math.min(1, Math.max(0.08, Math.pow(peak / loudest, 0.65))),
    );

    void context.close();
    peaksCache.set(url, normalized);

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      durationCache.set(url, audio.duration);
    }

    return normalized;
  } catch {
    return null;
  }
}

export function initialsFor(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

  if (words.length === 0) return "?";

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
