/**
 * Text-to-speech models exposed by the Higgsfield CLI, mirroring
 * `higgsfield model list --audio` and `higgsfield model get <job_type>`.
 *
 * Only the text-to-speech models are modeled for now. Voice change, voice
 * cloning, dialogue (Eleven v4), music (Sonilo) and sound effects (Mirelo)
 * have their own input shapes and come later.
 *
 * Every value here is the verbatim enum the CLI accepts, so it can be
 * forwarded as `--variant`, `--voice_id`, `--voice_type`, `--language`, ...
 * unchanged.
 */

export type VoiceType = "preset" | "element";

export interface AudioVoiceRef {
  id: string;
  type: VoiceType;
  /** Display name, kept alongside the id so the pill can render offline. */
  name: string;
}

export interface AudioModelExtraOption {
  value: string;
  label: string;
}

export interface AudioModelExtra {
  /** CLI flag name, e.g. `speech_rate`. */
  key: string;
  label: string;
  kind: "select" | "number" | "text";
  defaultValue: string;
  options?: AudioModelExtraOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** Promoted to its own pill in the dock; otherwise it lives in settings. */
  pill?: boolean;
}

export interface AudioVoiceConfig {
  /** CLI flag carrying the voice: `voice_id` or `voice` (Inworld's enum). */
  param: "voice_id" | "voice";
  /** Flag carrying `preset`/`element`; only library voices need it. */
  typeParam?: "voice_type";
  /** `library` voices come from `higgsfield voices list`, `fixed` is an enum. */
  source: "library" | "fixed";
  /** Verbatim enum for `source: "fixed"` models. */
  fixedOptions?: string[];
  required: boolean;
}

export interface AudioModel {
  /** CLI job type, e.g. `text2speech_v2`. */
  id: string;
  name: string;
  tagline: string;
  /** Max characters the provider accepts, or the per-engine limits. */
  maxChars?: number;
  charLimits?: Record<string, number>;
  promptLabel: string;
  promptPlaceholder: string;
  voice: AudioVoiceConfig;
  variants?: {
    param: string;
    label: string;
    defaultValue: string;
    options: AudioModelExtraOption[];
  };
  extras?: AudioModelExtra[];
}

function options(
  values: (string | [string, string])[],
): AudioModelExtraOption[] {
  return values.map((value) =>
    typeof value === "string"
      ? { value, label: value }
      : {
          value: value[0],
          label: value[1],
        },
  );
}

const LANGUAGE: AudioModelExtra = {
  key: "language",
  label: "Language",
  kind: "select",
  defaultValue: "",
  pill: true,
  options: [
    { value: "", label: "Auto" },
    ...options([
      ["en", "English"],
      ["zh", "Chinese"],
      ["fr", "French"],
      ["de", "German"],
      ["ja", "Japanese"],
      ["ko", "Korean"],
      ["ru", "Russian"],
      ["pt", "Portuguese"],
      ["it", "Italian"],
      ["es", "Spanish"],
      ["th", "Thai"],
      ["id", "Indonesian"],
      ["vi", "Vietnamese"],
      ["ms", "Malay"],
    ]),
  ],
};

const FORMAT: AudioModelExtra = {
  key: "format",
  label: "Format",
  kind: "select",
  defaultValue: "mp3",
  options: options([
    ["mp3", "MP3"],
    ["wav", "WAV"],
    ["pcm", "PCM"],
    ["ogg_opus", "OGG Opus"],
  ]),
};

const QWEN_SAMPLE_RATE: AudioModelExtra = {
  key: "sample_rate",
  label: "Sample rate",
  kind: "select",
  defaultValue: "24000",
  options: options(["8000", "16000", "22050", "24000", "44100", "48000"]),
};

const SEED_SAMPLE_RATE: AudioModelExtra = {
  key: "sample_rate",
  label: "Sample rate",
  kind: "select",
  defaultValue: "24000",
  options: options(["8000", "16000", "24000", "32000", "44100", "48000"]),
};

const INWORLD_VOICES = [
  "Loretta (en)",
  "Darlene (en)",
  "Marlene (en)",
  "Hank (en)",
  "Evelyn (en)",
  "Celeste (en)",
  "Pippa (en)",
  "Tessa (en)",
  "Liam (en)",
  "Callum (en)",
  "Hamish (en)",
  "Abby (en)",
  "Graham (en)",
  "Rupert (en)",
  "Mortimer (en)",
  "Snik (en)",
  "Anjali (en)",
  "Saanvi (en)",
  "Arjun (en)",
  "Claire (en)",
  "Oliver (en)",
  "Simon (en)",
  "Elliot (en)",
  "James (en)",
  "Serena (en)",
  "Gareth (en)",
  "Vinny (en)",
  "Lauren (en)",
  "Jessica (en)",
  "Ethan (en)",
  "Tyler (en)",
  "Jason (en)",
  "Chloe (en)",
  "Veronica (en)",
  "Victoria (en)",
  "Miranda (en)",
  "Sebastian (en)",
  "Victor (en)",
  "Malcolm (en)",
  "Kayla (en)",
  "Nate (en)",
  "Jake (en)",
  "Brian (en)",
  "Amina (en)",
  "Kelsey (en)",
  "Derek (en)",
  "Grant (en)",
  "Evan (en)",
  "Alex (en)",
  "Ashley (en)",
  "Craig (en)",
  "Deborah (en)",
  "Dennis (en)",
  "Edward (en)",
  "Elizabeth (en)",
  "Hades (en)",
  "Julia (en)",
  "Pixie (en)",
  "Mark (en)",
  "Olivia (en)",
  "Priya (en)",
  "Ronald (en)",
  "Sarah (en)",
  "Shaun (en)",
  "Theodore (en)",
  "Timothy (en)",
  "Wendy (en)",
  "Dominus (en)",
  "Hana (en)",
  "Clive (en)",
  "Carter (en)",
  "Blake (en)",
  "Luna (en)",
  "Yichen (zh)",
  "Xiaoyin (zh)",
  "Xinyi (zh)",
  "Jing (zh)",
  "Erik (nl)",
  "Katrien (nl)",
  "Lennart (nl)",
  "Lore (nl)",
  "Alain (fr)",
  "Hélène (fr)",
  "Mathieu (fr)",
  "Étienne (fr)",
  "Johanna (de)",
  "Josef (de)",
  "Gianni (it)",
  "Orietta (it)",
  "Asuka (ja)",
  "Satoshi (ja)",
  "Hyunwoo (ko)",
  "Minji (ko)",
  "Seojun (ko)",
  "Yoona (ko)",
  "Szymon (pl)",
  "Wojciech (pl)",
  "Heitor (pt)",
  "Maitê (pt)",
  "Diego (es)",
  "Lupita (es)",
  "Miguel (es)",
  "Rafael (es)",
  "Svetlana (ru)",
  "Elena (ru)",
  "Dmitry (ru)",
  "Nikolai (ru)",
  "Riya (hi)",
  "Manoj (hi)",
  "Yael (he)",
  "Oren (he)",
  "Nour (ar)",
  "Omar (ar)",
];

export const AUDIO_MODELS: AudioModel[] = [
  {
    id: "text2speech_v2",
    name: "Text to Speech V2",
    tagline: "Five engines behind one voice library",
    maxChars: 5000,
    charLimits: {
      elevenlabs: 5000,
      minimax: 10000,
      seed_speech: 15000,
      vibe_voice: 5000,
      cozy_voice: 5000,
    },
    promptLabel: "Script",
    promptPlaceholder: "Type or paste what the voice should say…",
    voice: {
      param: "voice_id",
      typeParam: "voice_type",
      source: "library",
      required: true,
    },
    variants: {
      param: "variant",
      label: "Engine",
      defaultValue: "elevenlabs",
      options: options([
        ["elevenlabs", "ElevenLabs"],
        ["minimax", "MiniMax"],
        ["seed_speech", "Seed Speech"],
        ["vibe_voice", "Vibe Voice"],
        ["cozy_voice", "Cozy Voice"],
      ]),
    },
  },
  {
    id: "inworld_text_to_speech",
    name: "Inworld TTS",
    tagline: "Character voices across 20+ languages",
    promptLabel: "Script",
    promptPlaceholder: "Type or paste what the voice should say…",
    voice: {
      param: "voice",
      source: "fixed",
      fixedOptions: INWORLD_VOICES,
      required: true,
    },
  },
  {
    id: "qwen_audio_tts",
    name: "Qwen TTS Flash",
    tagline: "Fast, steerable speech with fine controls",
    promptLabel: "Script",
    promptPlaceholder: "Type or paste what the voice should say…",
    voice: {
      param: "voice_id",
      typeParam: "voice_type",
      source: "library",
      required: true,
    },
    extras: [
      LANGUAGE,
      {
        key: "instruction",
        label: "Style direction",
        kind: "text",
        defaultValue: "",
        placeholder: "e.g. warm, calm, slightly amused",
      },
      {
        key: "speech_rate",
        label: "Speed",
        kind: "number",
        defaultValue: "1",
        min: 0.5,
        max: 2,
        step: 0.05,
      },
      {
        key: "pitch_rate",
        label: "Pitch",
        kind: "number",
        defaultValue: "1",
        min: 0.5,
        max: 2,
        step: 0.05,
      },
      {
        key: "volume",
        label: "Volume",
        kind: "number",
        defaultValue: "50",
        min: 0,
        max: 100,
        step: 1,
      },
      { ...FORMAT, defaultValue: "mp3" },
      QWEN_SAMPLE_RATE,
      {
        key: "seed",
        label: "Seed",
        kind: "number",
        defaultValue: "0",
        min: 0,
        step: 1,
      },
      {
        key: "batch_size",
        label: "Takes per run",
        kind: "select",
        defaultValue: "1",
        options: options(["1", "2", "3", "4"]),
      },
    ],
  },
  {
    id: "seed_audio",
    name: "Seed Audio 1.0",
    tagline: "Expressive, controllable speech",
    promptLabel: "Script",
    promptPlaceholder: "Type or paste what should be spoken…",
    voice: {
      param: "voice_id",
      typeParam: "voice_type",
      source: "library",
      required: true,
    },
    extras: [
      {
        key: "speech_rate",
        label: "Speed",
        kind: "number",
        defaultValue: "0",
        min: -50,
        max: 100,
        step: 1,
      },
      {
        key: "pitch_rate",
        label: "Pitch",
        kind: "number",
        defaultValue: "0",
        min: -12,
        max: 12,
        step: 1,
      },
      {
        key: "loudness_rate",
        label: "Loudness",
        kind: "number",
        defaultValue: "0",
        min: -50,
        max: 100,
        step: 1,
      },
      { ...FORMAT, defaultValue: "wav" },
      SEED_SAMPLE_RATE,
    ],
  },
];

export const DEFAULT_AUDIO_MODEL_ID = "text2speech_v2";

export function getAudioModel(id: string): AudioModel {
  return (
    AUDIO_MODELS.find((model) => model.id === id) ??
    AUDIO_MODELS.find((model) => model.id === DEFAULT_AUDIO_MODEL_ID) ??
    (AUDIO_MODELS[0] as AudioModel)
  );
}

/** Per-engine limit, falling back to the model-wide limit. */
export function charLimitOf(
  model: AudioModel,
  variant?: string,
): number | null {
  if (variant && model.charLimits?.[variant] !== undefined) {
    return model.charLimits[variant];
  }

  return model.maxChars ?? null;
}

export function defaultExtrasOf(model: AudioModel): Record<string, string> {
  return Object.fromEntries(
    (model.extras ?? []).map((extra) => [extra.key, extra.defaultValue]),
  );
}

/**
 * Mirrors the API's preview lines (`apps/api/src/lib/audio-preview.ts`) so the
 * picker can show the sentence the moment a preview starts, before the first
 * response lands. Both sides hash the voice id to pick the same line.
 */
const PREVIEW_SENTENCES = [
  "The morning train leaves at seven fifteen, so let's meet by the north entrance.",
  "I've been thinking about that book you lent me; the ending caught me completely off guard.",
  "Thanks for calling. Your appointment is confirmed for Thursday at four o'clock.",
  "Somewhere past the last ridge, the road opens onto a valley that looks almost unreal.",
  "Take a deep breath, slow down, and tell me everything from the beginning.",
];

export function previewSentenceFor(voiceId: string): string {
  let hash = 0;

  for (let index = 0; index < voiceId.length; index += 1) {
    hash = (hash * 31 + voiceId.charCodeAt(index)) | 0;
  }

  return PREVIEW_SENTENCES[Math.abs(hash) % PREVIEW_SENTENCES.length] as string;
}

/** Human label for Inworld's `Name (lang)` enum values. */ export function voiceLabel(
  value: string,
): string {
  return value.replace(/\s*\([a-z]{2}\)$/i, "");
}

export function voiceLanguage(value: string): string | null {
  return /\(([a-z]{2})\)$/i.exec(value)?.[1]?.toUpperCase() ?? null;
}

/**
 * The CLI flags for the current voice + extras. Empty optional values are
 * dropped so the provider keeps its own default.
 */
export function buildAudioParams(input: {
  model: string;
  variant?: string;
  voice: AudioVoiceRef | null;
  extras: Record<string, string>;
}): Record<string, string> {
  const model = getAudioModel(input.model);
  const params: Record<string, string> = {};

  if (model.variants && input.variant) {
    params[model.variants.param] = input.variant;
  }

  if (input.voice) {
    if (model.voice.param === "voice") {
      params.voice = input.voice.id;
    } else {
      params[model.voice.param] = input.voice.id;
      if (model.voice.typeParam) {
        params[model.voice.typeParam] = input.voice.type;
      }
    }
  }

  for (const extra of model.extras ?? []) {
    const value = input.extras[extra.key];

    if (value !== undefined && value !== "") {
      params[extra.key] = value;
    }
  }

  return params;
}

/** Drops values a model no longer accepts (used when switching models). */
export function sanitizeExtras(
  model: AudioModel,
  extras: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    (model.extras ?? []).map((extra) => {
      const candidate = extras?.[extra.key];

      if (typeof candidate !== "string") return [extra.key, extra.defaultValue];

      if (extra.kind === "select") {
        return [
          extra.key,
          extra.options?.some((option) => option.value === candidate)
            ? candidate
            : extra.defaultValue,
        ];
      }

      if (extra.kind === "number") {
        const numeric = Number(candidate);

        if (
          !Number.isFinite(numeric) ||
          (extra.min !== undefined && numeric < extra.min) ||
          (extra.max !== undefined && numeric > extra.max)
        ) {
          return [extra.key, extra.defaultValue];
        }
      }

      return [extra.key, candidate];
    }),
  );
}
