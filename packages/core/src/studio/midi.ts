// Web MIDI: keys play notes, the sustain pedal holds them, the pitch wheel
// drives Chaos, program changes recall scenes, and any CC can be learned onto
// a knob, a fader, or an action.

import { noteOff, noteOn, setSustain } from "./notes.ts";
import { param, runAction, setNormalized } from "./params.ts";
import { useLive, useStudio } from "./store.ts";

const SUSTAIN_CC = 64;
const BEND_CENTER = 8192;

let access: MIDIAccess | null = null;
const buttonState = new Map<string, boolean>();

export function ccKey(channel: number, controller: number): string {
  return `cc:${channel + 1}:${controller}`;
}

export function mappingLabel(key: string): string {
  const [, channel, controller] = key.split(":");
  return `CC ${controller} · ch ${channel}`;
}

/** The controller mapped to a param or action, if any. */
export function mappingFor(
  target: string,
  map: Record<string, string> = useStudio.getState().midiMap
): string | null {
  for (const [key, value] of Object.entries(map)) {
    if (value === target) {
      return key;
    }
  }
  return null;
}

export function unmap(key: string): void {
  const map = { ...useStudio.getState().midiMap };
  delete map[key];
  useStudio.getState().patch({ midiMap: map });
}

function learn(key: string, target: string): void {
  const map = { ...useStudio.getState().midiMap };
  for (const [existing, value] of Object.entries(map)) {
    if (value === target) {
      delete map[existing];
    }
  }
  map[key] = target;
  useStudio.getState().patch({ midiMap: map });
  useLive.setState({ learnTarget: null });
}

function onControl(channel: number, controller: number, value: number): void {
  const key = ccKey(channel, controller);
  const target = useLive.getState().learnTarget;
  if (target) {
    learn(key, target);
    return;
  }
  const mapped = useStudio.getState().midiMap[key];
  if (mapped) {
    if (param(mapped)) {
      setNormalized(mapped, value / 127);
      return;
    }
    // Buttons fire on the press, not the release.
    const pressed = value >= 64;
    if (pressed && !buttonState.get(key)) {
      runAction(mapped);
    }
    buttonState.set(key, pressed);
    return;
  }
  if (controller === SUSTAIN_CC) {
    setSustain(value >= 64);
  }
}

function onMessage(event: MIDIMessageEvent): void {
  const data = event.data;
  if (!data || data.length < 2) {
    return;
  }
  const head = data[0] ?? 0;
  const channel = head % 16;
  const status = head - channel;
  const first = data[1] ?? 0;
  const second = data[2] ?? 0;
  if (status === 0x90 && second > 0) {
    noteOn(first, "midi");
  } else if (status === 0x80 || (status === 0x90 && second === 0)) {
    noteOff(first, "midi");
  } else if (status === 0xb0) {
    onControl(channel, first, second);
  } else if (status === 0xc0) {
    runAction(`scene.${(first % 8) + 1}`);
  } else if (status === 0xe0) {
    const bend = second * 128 + first - BEND_CENTER;
    useLive.setState({ chaos: Math.max(-1, Math.min(1, bend / BEND_CENTER)) });
  }
}

function refresh(): void {
  if (!access) {
    return;
  }
  const devices: { id: string; name: string }[] = [];
  for (const input of access.inputs.values()) {
    input.onmidimessage = onMessage;
    devices.push({ id: input.id, name: input.name ?? "MIDI input" });
  }
  useLive.setState({ midiDevices: devices, midiStatus: "ready" });
}

export async function startMidi(): Promise<void> {
  if (access) {
    refresh();
    return;
  }
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    useLive.setState({ midiStatus: "unsupported" });
    return;
  }
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    useLive.setState({ midiStatus: "denied" });
    return;
  }
  access.onstatechange = refresh;
  refresh();
}
