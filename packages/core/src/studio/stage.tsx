"use client";

import { Toaster } from "@workspace/ui/components/sonner";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureLast, toggleRecord } from "./actions.ts";
import { pruneClips } from "./clips.ts";
import {
  freshStart,
  recallScene,
  reroll,
  saveScene,
  startConductor,
  tapTempo,
  togglePlay,
  toggleProgression,
} from "./conductor.ts";
import { engine } from "./engine.ts";
import { startMidi } from "./midi.ts";
import { allNotesOff, setHold } from "./notes.ts";
import { type ActionDef, registerActions } from "./params.ts";
import { promptShares } from "./spec.ts";
import { useLive, useStudio } from "./store.ts";
import { AudioPromptDialog, type AudioSource } from "./ui/audio-dialog.tsx";
import { EngineBanner } from "./ui/engine-banner.tsx";
import { FxPanel } from "./ui/fx-panel.tsx";
import { HelpDialog } from "./ui/help.tsx";
import { SHORTCUT_LABELS, useStageHotkeys } from "./ui/hotkeys.ts";
import { LibraryDialog } from "./ui/library.tsx";
import { ModelPanel } from "./ui/model-panel.tsx";
import { NotesDock } from "./ui/notes-dock.tsx";
import { CommandPalette } from "./ui/palette.tsx";
import { ScenesPanel } from "./ui/scenes-panel.tsx";
import { StylePanel } from "./ui/style-panel.tsx";
import { TakesSheet } from "./ui/takes.tsx";
import { TopBar } from "./ui/top-bar.tsx";
import { Visualizer } from "./ui/visualizer.tsx";

/** Soft light behind the stage, tinted by whatever the blend is right now. */
function Ambience() {
  const prompts = useStudio((state) => state.prompts);
  const mixMode = useStudio((state) => state.mixMode);
  const listener = useStudio((state) => state.listener);
  const phase = useLive((state) => state.phase);
  const shares = useMemo(
    () => promptShares(prompts, mixMode, listener),
    [prompts, mixMode, listener]
  );
  const ranked = prompts
    .map((prompt, index) => ({
      color: prompt.color,
      share: shares[index] ?? 0,
    }))
    .filter((item) => item.share > 0)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);
  const spots = ["18% 22%", "82% 30%", "50% 92%"];
  const strength = phase === "live" ? 1 : 0.55;
  const background = ranked
    .map(
      (item, index) =>
        `radial-gradient(60% 55% at ${spots[index]}, ${item.color}${Math.round(
          (0.08 + item.share * 0.16) * strength * 255
        )
          .toString(16)
          .padStart(2, "0")}, transparent 70%)`
    )
    .join(", ");
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 transition-[background] duration-1000"
      style={{ background: background || undefined }}
    />
  );
}

function useRehydrated(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const finish = () => setReady(true);
    const off = useStudio.persist.onFinishHydration(finish);
    if (useStudio.persist.hasHydrated()) {
      finish();
    } else {
      Promise.resolve(useStudio.persist.rehydrate()).catch(finish);
    }
    return off;
  }, []);
  return ready;
}

export function Stage() {
  const ready = useRehydrated();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [takes, setTakes] = useState(false);
  const [library, setLibrary] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const promptInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!wasDark) {
        root.classList.remove("dark");
      }
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const stopWatching = engine.watch();
    const stopConductor = startConductor();
    startMidi().catch(() => undefined);
    const studio = useStudio.getState();
    const keep = new Set<string>();
    for (const prompt of [
      ...studio.prompts,
      ...studio.scenes.flatMap((scene) => scene?.prompts ?? []),
    ]) {
      if (prompt.clipKey) {
        keep.add(prompt.clipKey);
      }
    }
    pruneClips(keep).catch(() => undefined);
    return () => {
      stopWatching();
      stopConductor();
    };
  }, [ready]);

  const openPalette = useCallback(() => setPalette(true), []);
  const openHelp = useCallback(() => setHelp(true), []);
  useStageHotkeys(openPalette, openHelp);

  useEffect(() => {
    const list: ActionDef[] = [
      {
        group: "Transport",
        id: "transport.play",
        label: "Play or stop",
        run: togglePlay,
      },
      {
        group: "Transport",
        id: "model.reroll",
        label: "Re-roll the seed",
        run: reroll,
      },
      {
        group: "Transport",
        id: "model.fresh",
        label: "Fresh start",
        run: freshStart,
      },
      {
        group: "Transport",
        id: "tempo.tap",
        label: "Tap tempo",
        run: () => {
          tapTempo();
        },
      },
      {
        group: "Takes",
        id: "takes.record",
        label: "Record or stop recording",
        run: () => {
          toggleRecord().catch(() => undefined);
        },
      },
      {
        group: "Takes",
        id: "takes.keep30",
        label: "Keep the last 30 seconds",
        run: () => {
          captureLast(30).catch(() => undefined);
        },
      },
      {
        group: "Takes",
        id: "takes.keep60",
        label: "Keep the last minute",
        run: () => {
          captureLast(60).catch(() => undefined);
        },
      },
      {
        group: "Takes",
        id: "takes.open",
        label: "Show takes",
        run: () => setTakes(true),
      },
      {
        group: "Style",
        id: "prompt.focus",
        label: "Type a new prompt",
        run: () => {
          if (useStudio.getState().mixMode !== "list") {
            useStudio.getState().patch({ mixMode: "list" });
          }
          window.setTimeout(() => promptInput.current?.focus(), 0);
        },
      },
      {
        group: "Style",
        id: "style.mode",
        label: "Switch between List and Space",
        run: () => {
          const studio = useStudio.getState();
          studio.patch({
            mixMode: studio.mixMode === "list" ? "space" : "list",
          });
        },
      },
      {
        group: "Style",
        id: "style.orbit",
        label: "Orbit the listener",
        run: () => {
          const studio = useStudio.getState();
          studio.patch({ mixMode: "space", orbit: studio.orbit > 0 ? 0 : 0.5 });
        },
      },
      {
        group: "Notes",
        id: "notes.hold",
        label: "Hold on or off",
        run: () => setHold(!useStudio.getState().hold),
      },
      {
        group: "Notes",
        id: "notes.release",
        label: "Release every note",
        run: allNotesOff,
      },
      {
        group: "Notes",
        id: "notes.mode",
        label: "Switch between Jam and Solo",
        run: () => {
          const studio = useStudio.getState();
          studio.patch({
            noteMode: studio.noteMode === "jam" ? "solo" : "jam",
          });
        },
      },
      {
        group: "Notes",
        id: "notes.progression",
        label: "Play or stop the chord progression",
        run: toggleProgression,
      },
      {
        group: "Model",
        id: "drums.cycle",
        label: "Drums: auto, on, off",
        run: () => {
          const order = ["auto", "on", "off"] as const;
          const studio = useStudio.getState();
          const next =
            order[(order.indexOf(studio.drums) + 1) % order.length] ?? "auto";
          studio.patch({ drums: next });
        },
      },
      {
        group: "MIDI",
        id: "midi.learn",
        label: "MIDI learn on or off",
        run: () => {
          const live = useLive.getState();
          useLive.setState({ learn: !live.learn, learnTarget: null });
        },
      },
      {
        group: "Help",
        id: "help.open",
        label: "Shortcuts and tips",
        run: openHelp,
      },
      {
        group: "Style",
        id: "library.open",
        label: "Open the sound library",
        run: () => setLibrary(true),
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        group: "Scenes",
        id: `scene.${index + 1}`,
        label: `Recall scene ${index + 1}`,
        run: () => recallScene(index),
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        group: "Scenes",
        id: `scene.save.${index + 1}`,
        label: `Save scene ${index + 1}`,
        run: () => saveScene(index),
      })),
    ];
    return registerActions(list);
  }, [openHelp]);

  if (!ready) {
    return <div className="h-dvh w-screen bg-[#09080b]" />;
  }

  return (
    <TooltipProvider delayDuration={450}>
      <div className="relative flex h-dvh w-screen flex-col overflow-hidden bg-[#09080b] text-white">
        <Ambience />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <TopBar
            onHelp={openHelp}
            onPalette={openPalette}
            onTakes={() => setTakes(true)}
          />
          <EngineBanner />
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_392px] gap-3 p-3">
            <div className="flex min-h-0 flex-col gap-3">
              <StylePanel
                inputRef={promptInput}
                onAudio={setAudioSource}
                onLibrary={() => setLibrary(true)}
              />
              <Visualizer className="h-[clamp(96px,17vh,176px)] shrink-0" />
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto [scrollbar-width:thin]">
              <ModelPanel />
              <ScenesPanel />
              <FxPanel />
            </div>
          </main>
          <div className="px-3 pb-3">
            <NotesDock />
          </div>
        </div>
        <CommandPalette
          onOpenChange={setPalette}
          open={palette}
          shortcuts={SHORTCUT_LABELS}
        />
        <HelpDialog onOpenChange={setHelp} open={help} />
        <LibraryDialog onOpenChange={setLibrary} open={library} />
        <TakesSheet
          onOpenChange={setTakes}
          onStyle={setAudioSource}
          open={takes}
        />
        <AudioPromptDialog
          onClose={() => setAudioSource(null)}
          source={audioSource}
        />
        <Toaster position="bottom-center" theme="dark" />
      </div>
    </TooltipProvider>
  );
}
