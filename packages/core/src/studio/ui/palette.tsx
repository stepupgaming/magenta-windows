"use client";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@workspace/ui/components/command";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { addTextPrompt, applyPreset } from "../actions.ts";
import { SESSION_PRESETS } from "../library.ts";
import { allActions } from "../params.ts";

const SPACES = /\s+/;

/** Every typed word must appear. Adding the text as a prompt always ranks last. */
function rank(value: string, search: string): number {
  if (value.startsWith("add prompt ")) {
    return 0.001;
  }
  const haystack = value.toLowerCase();
  const words = search.toLowerCase().split(SPACES).filter(Boolean);
  if (!words.every((word) => haystack.includes(word))) {
    return 0;
  }
  return haystack.startsWith(words[0] ?? "") ? 1 : 0.5;
}

export interface PaletteShortcut {
  [actionId: string]: string;
}

export function CommandPalette({
  onOpenChange,
  open,
  shortcuts,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  shortcuts: PaletteShortcut;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const byGroup = new Map<string, ReturnType<typeof allActions>>();
    if (!open) {
      return byGroup;
    }
    for (const action of allActions()) {
      const list = byGroup.get(action.group) ?? [];
      list.push(action);
      byGroup.set(action.group, list);
    }
    return byGroup;
  }, [open]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    setQuery("");
    window.setTimeout(fn, 0);
  };

  return (
    <CommandDialog
      className="border-white/10 bg-[#141317] text-white"
      description="Search every action on the stage"
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
        }
      }}
      open={open}
      title="Command palette"
    >
      <Command className="bg-transparent text-white" filter={rank}>
        <CommandInput
          onKeyDown={(event) => event.stopPropagation()}
          onValueChange={setQuery}
          placeholder="Search actions, or type a sound to add it"
          value={query}
        />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>Nothing matches.</CommandEmpty>

          {[...groups.entries()].map(([group, actions]) => (
            <CommandGroup heading={group} key={group}>
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={() => run(action.run)}
                  value={`${group} ${action.label}`}
                >
                  {action.label}
                  {shortcuts[action.id] ? (
                    <CommandShortcut>{shortcuts[action.id]}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Starter sessions">
            {SESSION_PRESETS.map((preset) => (
              <CommandItem
                key={preset.name}
                onSelect={() => run(() => applyPreset(preset))}
                value={`session ${preset.name} ${preset.description}`}
              >
                <div className="flex flex-col">
                  <span>{preset.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {preset.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
          {query.trim().length > 2 ? (
            <CommandGroup heading="Prompt">
              <CommandItem
                onSelect={() => run(() => addTextPrompt(query))}
                value={`add prompt ${query}`}
              >
                <Plus className="size-4" />
                Add “{query.trim()}” as a prompt
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
