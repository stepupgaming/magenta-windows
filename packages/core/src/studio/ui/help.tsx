"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Kbd } from "./kit.tsx";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play or stop"],
  ["A W S E D F T G Y H U J K O L P", "Play notes"],
  ["Z  X", "Octave down, up"],
  ["Q", "Hold (latch chords)"],
  ["Esc", "Release every note"],
  ["1 – 8", "Recall a scene"],
  ["Shift + 1 – 8", "Save a scene"],
  ["Backspace", "Rewind and play on from there"],
  ["R", "Record"],
  ["C", "Keep the last 30 seconds"],
  ["/", "Search the sound library"],
  ["N", "Type a new prompt"],
  ["V", "List or Space"],
  ["B", "Tap tempo"],
  ["M", "MIDI learn"],
  ["Ctrl K", "Command palette"],
  ["?", "This help"],
];

const IDEAS: [string, string][] = [
  [
    "Style",
    "Every prompt, text or audio, becomes a point in the same style space. The blend is a weighted average of those points, so two prompts at 50% sound like something between them, not both at once. The model hears broad strokes, so “warm jazz piano” works better than a long sentence.",
  ],
  [
    "Space",
    "Place prompts in a field and move the listener. Pull falls off with the square of the distance, like the Collider demo. Fling prompts or let the listener orbit for music that keeps evolving.",
  ],
  [
    "Style detail",
    "A blended style reaches the model as 12 tokens, from broad to fine, and all 12 steer by default. Turn Style detail down for a looser reading of each prompt.",
  ],
  [
    "Notes",
    "In Jam the model plays around the notes you hold and adds its own. In Solo it plays only your notes and stays quiet between them. Strum lets held notes re-strike. Clearance keeps the model away from the semitones next to yours.",
  ],
  [
    "Strength",
    "Style and Notes set how hard each request is pushed. Very high values held for a long time can run away or fade out, so ride them rather than parking them at the top.",
  ],
  [
    "Temperature and Chaos",
    "Temperature is how adventurous each 40 ms step is. Chaos is a spring: push it for a moment and it returns to center. The pitch wheel on a MIDI keyboard moves it too.",
  ],
  [
    "Scenes",
    "A scene saves the sound: prompts, positions, and knobs. Morph glides there over a number of beats. Cut jumps at once, and a scene saved while playing also takes the model back to the groove it was in. With the same notes and knobs, it plays out the same way each time.",
  ],
  [
    "Continue",
    "The model can pick up from any audio as if it had just played it: a moment it played (Rewind goes back 5 to 20 seconds), a take, or a file of your own. It listens to up to 28 seconds, replays the last two, and carries on about a second before the end, steered by your prompts and notes. Each rewind takes the music somewhere new.",
  ],
  [
    "Timing",
    "The model writes one 40 ms frame at a time and remembers about the last 20 seconds. The window holds a cushion of audio so the GPU never runs dry, so you hear changes about a second after you make them. Fresh start clears the memory.",
  ],
];

export function HelpDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-[#121116] text-white sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Playing Magenta RealTime 2</DialogTitle>
          <DialogDescription className="text-white/55">
            A live music model you steer with words, sounds, and notes while it
            plays.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
          <ul className="flex flex-col gap-1.5">
            {SHORTCUTS.map(([keys, label]) => (
              <li
                className="flex items-center justify-between gap-3 text-sm"
                key={label}
              >
                <span className="text-white/70">{label}</span>
                <span className="flex flex-wrap justify-end gap-1">
                  {keys.split("  ").map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3.5">
            {IDEAS.map(([title, body]) => (
              <div key={title}>
                <p className="font-medium text-sm">{title}</p>
                <p className="mt-0.5 text-[13px] text-white/60 leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
