// Prompt ideas for the suggestion rail, and starter sessions.

import { LIBRARY_BLENDS } from "./library-data.ts";
import type { StudioSettings } from "./store.ts";
import { clamp, placeFor, STUDIO_DEFAULTS, textPrompt } from "./store.ts";
import type { DrumMode, MixMode, NoteMode, StylePrompt } from "./types.ts";

export interface PromptShelf {
  ideas: string[];
  label: string;
}

export const PROMPT_SHELVES: PromptShelf[] = [
  {
    ideas: [
      "lo-fi hip hop beat",
      "deep house groove",
      "driving minimal techno",
      "synthwave",
      "drum and bass",
      "smooth bossa nova",
      "jazz piano trio",
      "afrobeat band with horns",
      "french house filter disco",
      "ambient IDM glitch beats",
      "dark cinematic soundtrack",
      "trip hop",
      "UK garage shuffle",
      "dub reggae with spring reverb",
      "chiptune",
      "neo soul",
      "shoegaze wall of guitars",
      "baroque harpsichord",
      "west african kora polyrhythms",
      "brazilian samba batucada",
      "trap beat with sampled funk",
      "celtic fiddle jig",
      "indian classical sitar and tabla raga",
      "flamenco nylon guitar rasgueado",
    ],
    label: "Genres",
  },
  {
    ideas: [
      "soothing chords",
      "warm rhodes electric piano",
      "felt piano",
      "string ensemble",
      "solo cello",
      "nylon string guitar",
      "upright bass",
      "acid 303 bassline",
      "moog bass",
      "analog synth pads",
      "trance arpeggiated synth",
      "supersaw chords",
      "church organ",
      "vibraphone",
      "marimba",
      "kalimba",
      "japanese koto",
      "chinese guzheng",
      "harp glissandos",
      "breathy flute",
      "muted trumpet",
      "tenor saxophone",
      "choir aahs",
      "music box",
    ],
    label: "Instruments",
  },
  {
    ideas: [
      "dusty lo-fi drums",
      "punchy 808 kick",
      "brushed jazz drums",
      "breakbeat",
      "four on the floor",
      "shuffled hi-hats",
      "taiko drums",
      "hand percussion",
      "gated reverb drums",
      "glitchy percussion",
    ],
    label: "Rhythm",
  },
  {
    ideas: [
      "dreamy",
      "melancholic",
      "euphoric",
      "tense and dark",
      "warm tape saturation",
      "vinyl crackle",
      "rain on a tin roof",
      "granular frozen textures",
      "cavernous reverb swells",
      "underwater",
      "distant and hazy",
      "bright and sparkling",
      "heavily distorted",
      "slow pad sweeps",
    ],
    label: "Textures",
  },
];

export const ALL_IDEAS = PROMPT_SHELVES.flatMap((shelf) => shelf.ideas);

export function randomIdea(exclude: readonly string[] = []): string {
  const pool = ALL_IDEAS.filter((idea) => !exclude.includes(idea));
  return pool[Math.floor(Math.random() * pool.length)] ?? "dreamy ambient pads";
}

export interface SessionPreset {
  description: string;
  drums: DrumMode;
  mixMode?: MixMode;
  name: string;
  noteMode: NoteMode;
  prompts: [string, number][];
  styleStrength?: number;
  temperature?: number;
}

const STAGE_PRESETS: SessionPreset[] = [
  {
    description: "Rhodes, dusty drums, a little vinyl.",
    drums: "auto",
    mixMode: "list",
    name: "Late night lo-fi",
    noteMode: "jam",
    prompts: [
      ["lo-fi hip hop beat", 0.7],
      ["warm rhodes electric piano", 0.5],
      ["vinyl crackle", 0.15],
    ],
  },
  {
    description: "Hypnotic kicks with acid on the side.",
    drums: "on",
    mixMode: "list",
    name: "Peak time techno",
    noteMode: "jam",
    prompts: [
      ["driving minimal techno", 0.8],
      ["acid 303 bassline", 0.4],
      ["four on the floor", 0.3],
    ],
    temperature: 1.1,
  },
  {
    description: "No drums. Pads and piano drifting in Space.",
    drums: "off",
    mixMode: "space",
    name: "Ambient drift",
    noteMode: "jam",
    prompts: [
      ["dreamy", 0.8],
      ["analog synth pads", 0.7],
      ["felt piano", 0.5],
      ["granular frozen textures", 0.4],
    ],
    temperature: 1,
  },
  {
    description: "Play chords on the keys and the trio follows.",
    drums: "auto",
    mixMode: "list",
    name: "Jazz trio",
    noteMode: "jam",
    prompts: [
      ["jazz piano trio", 0.9],
      ["upright bass", 0.4],
      ["brushed jazz drums", 0.35],
    ],
  },
  {
    description: "Strings and taiko for a trailer cue.",
    drums: "auto",
    mixMode: "list",
    name: "Cinematic",
    noteMode: "jam",
    prompts: [
      ["dark cinematic soundtrack", 0.7],
      ["string ensemble", 0.6],
      ["taiko drums", 0.3],
    ],
  },
  {
    description: "Kora, gamelan, and horns pulling at each other.",
    drums: "auto",
    mixMode: "space",
    name: "World fusion",
    noteMode: "jam",
    prompts: [
      ["west african kora polyrhythms", 0.7],
      ["afrobeat band with horns", 0.6],
      ["brazilian samba batucada", 0.5],
    ],
  },
  {
    description: "Retro leads over gated drums.",
    drums: "auto",
    mixMode: "list",
    name: "Synthwave night",
    noteMode: "jam",
    prompts: [
      ["synthwave", 0.8],
      ["supersaw chords", 0.4],
      ["gated reverb drums", 0.3],
    ],
  },
  {
    description: "Solo mode. Only the notes you hold sound.",
    drums: "off",
    mixMode: "list",
    name: "Solo cello",
    noteMode: "solo",
    prompts: [["solo cello", 1]],
    styleStrength: 3,
  },
];

export function presetSettings(preset: SessionPreset): Partial<StudioSettings> {
  const prompts: StylePrompt[] = [];
  for (const [text, weight] of preset.prompts) {
    const prompt = textPrompt(text, prompts, clamp(weight, 0, 1));
    const place = placeFor(prompts.length);
    prompts.push({ ...prompt, x: place.x, y: place.y });
  }
  return {
    drums: preset.drums,
    listener: { x: 0.5, y: 0.5 },
    mixMode: preset.mixMode ?? "list",
    noteMode: preset.noteMode,
    prompts,
    styleStrength: preset.styleStrength ?? STUDIO_DEFAULTS.styleStrength,
    temperature: preset.temperature ?? STUDIO_DEFAULTS.temperature,
  };
}

/** Researched blends first, then the stage's own starters that add something new. */
export const SESSION_PRESETS: SessionPreset[] = [
  ...LIBRARY_BLENDS,
  ...STAGE_PRESETS.filter(
    (preset) => !LIBRARY_BLENDS.some((blend) => blend.name === preset.name)
  ),
];
