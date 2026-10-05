"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import {
  Check,
  Clock,
  Layers,
  Library as LibraryIcon,
  Lightbulb,
  Plus,
  Replace,
  Search,
  Star,
  Volume2,
  X,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  addTextPrompt,
  applyPreset,
  replaceBlend,
  toggleFavorite,
} from "../actions.ts";
import { SESSION_PRESETS, type SessionPreset } from "../library.ts";
import { LIBRARY_CATEGORIES, LIBRARY_PROMPTS } from "../library-data.ts";
import {
  highlight,
  type IndexedEntry,
  indexEntries,
  normalize,
  type SearchHit,
  search,
  tokenize,
  topTags,
} from "../library-search.ts";
import { isPlaying, useLive, useStudio } from "../store.ts";
import { MAX_PROMPTS, PROMPT_COLORS } from "../types.ts";

type View = "all" | "blends" | "favorites" | "recent" | "tips" | string;

const TIPS: [string, string][] = [
  [
    "Short and concrete",
    "A genre, an instrument, and a texture or mood: “dusty jazz piano over lo-fi drums”. One to six words lands better than a sentence.",
  ],
  [
    "One anchor, a little color",
    "Give one prompt most of the weight and one or two others a little. Past four prompts, the blend averages into something generic.",
  ],
  [
    "Say what you want, not what you don't",
    "“No drums” sounds like drums to the model. Use the Drums switch, lower a weight, or add a contrasting prompt.",
  ],
  [
    "Voices have no words",
    "The model sings without lyrics. Try “wordless choir”, “humming vocals”, or “vocal chops”.",
  ],
  [
    "Bridge distant styles",
    "Two far-apart prompts meet in a middle that can sound like neither. Use a hybrid like “disco synthwave”, or morph between scenes.",
  ],
  [
    "Audio pins down a sound",
    "When words fall short, drop in ten seconds of audio. It carries the style and timbre, not the melody, and blends with text.",
  ],
  [
    "Vague? Push harder",
    "If the blend sounds unclear, raise Style strength before adding more words.",
  ],
];

function Tips() {
  return (
    <div className="grid grid-cols-2 gap-2 p-2">
      {TIPS.map(([title, body]) => (
        <div
          className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
          key={title}
        >
          <p className="font-medium text-[14px] text-white">{title}</p>
          <p className="mt-1 text-[13px] text-white/55 leading-relaxed">
            {body}
          </p>
        </div>
      ))}
    </div>
  );
}

const PAGE = 120;
const CATEGORY_LABEL = new Map(
  LIBRARY_CATEGORIES.map((item) => [item.id, item.label])
);
const labelFor = (id: string) => CATEGORY_LABEL.get(id) ?? "Yours";
const INDEX = indexEntries(LIBRARY_PROMPTS, labelFor);
const BY_TEXT = new Map(INDEX.map((entry) => [entry.text, entry]));

/** Favorites and recents may be prompts you typed yourself. */
function entriesFor(texts: string[]): IndexedEntry[] {
  return texts.map(
    (text) =>
      BY_TEXT.get(text) ??
      indexEntries([{ category: "yours", tags: [], text }], labelFor)[0] ?? {
        category: "yours",
        compact: text,
        hay: text,
        plain: text,
        tagWords: [],
        tags: [],
        text,
        words: [text],
      }
  );
}

function countLabel(
  blendView: boolean,
  blends: number,
  hits: SearchHit[]
): string {
  if (blendView) {
    return `${blends} blends`;
  }
  const related = hits.filter((hit) => hit.related).length;
  const full = hits.length - related;
  return related > 0
    ? `${full} matches · ${related} related`
    : `${full} sounds`;
}

function Marked({ query, text }: { query: string; text: string }) {
  const ranges = highlight(text, query);
  if (ranges.length === 0) {
    return <>{text}</>;
  }
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) {
      parts.push(text.slice(at, start));
    }
    parts.push(
      <mark className="rounded-sm bg-[#ff4c8d]/25 px-px text-white" key={start}>
        {text.slice(start, end)}
      </mark>
    );
    at = end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function NavButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors",
        active
          ? "bg-white/[0.1] text-white"
          : "text-white/60 hover:bg-white/[0.05] hover:text-white"
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="font-mono text-[10.5px] text-white/35 tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function ResultRow({
  added,
  favorite,
  full,
  hit,
  onSelect,
  previewing,
  query,
  selected,
}: {
  added: boolean;
  favorite: boolean;
  full: boolean;
  hit: SearchHit;
  onSelect: () => void;
  previewing: boolean;
  query: string;
  selected: boolean;
}) {
  const { entry } = hit;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  return (
    <div
      aria-selected={selected}
      className={cn(
        "group flex h-11 items-center gap-2 rounded-lg px-2 transition-colors [content-visibility:auto]",
        selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
      )}
      onMouseMove={onSelect}
      ref={ref}
      role="option"
      tabIndex={-1}
    >
      <button
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          favorite ? "text-amber-300" : "text-white/20 hover:text-white/70"
        )}
        onClick={() => toggleFavorite(entry.text)}
        type="button"
      >
        <Star className={cn("size-3.5", favorite && "fill-current")} />
      </button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className="truncate text-[14px] text-white/90">
          <Marked query={query} text={entry.text} />
        </span>
        <span className="hidden shrink-0 truncate text-[11px] text-white/35 md:inline">
          {labelFor(entry.category)}
          {entry.tags.length > 0
            ? ` · ${entry.tags.slice(0, 3).join(", ")}`
            : ""}
        </span>
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 transition-opacity",
          selected || previewing
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        )}
      >
        <button
          aria-label="Preview this sound alone"
          aria-pressed={previewing}
          className={cn(
            "flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] transition-colors",
            previewing
              ? "bg-[#ff4c8d] text-white"
              : "text-white/60 hover:bg-white/[0.08] hover:text-white"
          )}
          onClick={() =>
            useLive.setState({ audition: previewing ? null : entry.text })
          }
          type="button"
        >
          <Volume2 className="size-3.5" />
          Preview
        </button>
        <button
          aria-label="Replace the blend with this sound"
          className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] text-white/60 hover:bg-white/[0.08] hover:text-white"
          onClick={() => replaceBlend(entry.text)}
          type="button"
        >
          <Replace className="size-3.5" />
          Only this
        </button>
        <button
          aria-label="Add to the blend"
          className={cn(
            "flex h-7 items-center gap-1 rounded-full px-3 font-medium text-[11px] transition-colors disabled:opacity-40",
            added ? "bg-white/[0.08] text-white/60" : "bg-white text-black"
          )}
          disabled={added || full}
          onClick={() => addTextPrompt(entry.text)}
          type="button"
        >
          {added ? (
            <Check className="size-3.5" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {added ? "In blend" : "Add"}
        </button>
      </div>
    </div>
  );
}

function BlendCard({
  onApply,
  preset,
  selected,
}: {
  onApply: () => void;
  preset: SessionPreset;
  selected: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  return (
    <button
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
        selected
          ? "border-white/40 bg-white/[0.06]"
          : "border-white/[0.07] bg-white/[0.02] hover:border-white/25"
      )}
      onClick={onApply}
      ref={ref}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-[14px] text-white">
          {preset.name}
        </span>
        <span className="shrink-0 rounded-full border border-white/10 px-1.5 font-mono text-[9.5px] text-white/50 uppercase">
          {preset.noteMode === "solo" ? "solo" : `drums ${preset.drums}`}
        </span>
      </div>
      <p className="line-clamp-2 text-[12px] text-white/50 leading-snug">
        {preset.description}
      </p>
      <div className="flex flex-wrap gap-1">
        {preset.prompts.map(([text, weight], index) => (
          <span
            className="flex items-center gap-1 rounded-full bg-black/40 py-0.5 pr-2 pl-1 text-[11px] text-white/80"
            key={text}
          >
            <span
              className="size-2 rounded-full"
              style={{
                backgroundColor: PROMPT_COLORS[index % PROMPT_COLORS.length],
                opacity: 0.4 + weight * 0.6,
              }}
            />
            {text}
          </span>
        ))}
      </div>
    </button>
  );
}

export function LibraryDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [cursor, setCursor] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [preview, setPreview] = useState(false);
  const favorites = useStudio((state) => state.favorites);
  const recents = useStudio((state) => state.recents);
  const inBlend = useStudio(
    useShallow((state) =>
      state.prompts.map((prompt) => prompt.text.toLowerCase())
    )
  );
  const full = useStudio((state) => state.prompts.length >= MAX_PROMPTS);
  const audition = useLive((state) => state.audition);
  const playing = useLive((state) => isPlaying(state.phase));
  const input = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const blendView = view === "blends";
  const tipsView = view === "tips";

  const hits = useMemo(() => {
    if (blendView || tipsView) {
      return [];
    }
    if (view === "favorites") {
      return search(entriesFor(favorites), query, null);
    }
    if (view === "recent") {
      return search(entriesFor(recents), query, null);
    }
    return search(INDEX, query, view === "all" ? null : view);
  }, [blendView, favorites, query, recents, tipsView, view]);

  const blends = useMemo(() => {
    const words = tokenize(query);
    if (words.length === 0) {
      return SESSION_PRESETS;
    }
    return SESSION_PRESETS.filter((preset) => {
      const hay = normalize(
        `${preset.name} ${preset.description} ${preset.prompts.map(([text]) => text).join(" ")}`
      );
      return words.every((word) => hay.includes(word));
    });
  }, [query]);

  const refine = useMemo(
    () =>
      blendView || query.trim().length === 0
        ? []
        : topTags(hits, query.split(" "), 8),
    [blendView, hits, query]
  );

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const entry of INDEX) {
      tally.set(entry.category, (tally.get(entry.category) ?? 0) + 1);
    }
    return tally;
  }, []);

  const total = blendView ? blends.length : hits.length;
  const selected = hits[cursor]?.entry.text ?? null;

  useEffect(() => {
    if (!open) {
      setPreview(false);
      useLive.setState({ audition: null });
    }
  }, [open]);

  useEffect(() => {
    if (preview && !blendView) {
      useLive.setState({ audition: selected });
    }
  }, [blendView, preview, selected]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || limit >= total) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLimit((current) => current + PAGE);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, total]);

  const togglePreview = () => {
    const next = !preview;
    setPreview(next);
    useLive.setState({ audition: next ? selected : null });
  };

  const changeQuery = (next: string) => {
    if (view === "tips") {
      setView("all");
    }
    setQuery(next);
    setCursor(0);
    setLimit(PAGE);
  };

  const navigate = (next: View) => {
    setView(next);
    setCursor(0);
    setLimit(PAGE);
    input.current?.focus();
  };

  const choose = (event: KeyboardEvent<HTMLInputElement>) => {
    if (blendView) {
      const preset = blends[cursor];
      if (preset) {
        applyPreset(preset);
        onOpenChange(false);
      }
      return;
    }
    if (!selected) {
      if (query.trim() && addTextPrompt(query)) {
        changeQuery("");
      }
      return;
    }
    if (event.shiftKey) {
      replaceBlend(selected);
    } else {
      addTextPrompt(selected);
    }
    if (event.ctrlKey || event.metaKey) {
      onOpenChange(false);
    }
  };

  const atEnd = (target: HTMLInputElement) =>
    target.selectionStart === target.value.length;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const columns = blendView ? 2 : 1;
    const last = Math.max(0, total - 1);
    const moves: Record<string, number> = {
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setCursor((current) => Math.min(last, Math.max(0, current + move)));
      return;
    }
    if (event.key === "ArrowRight" && atEnd(event.currentTarget)) {
      event.preventDefault();
      if (blendView) {
        setCursor((current) => Math.min(last, current + 1));
      } else {
        togglePreview();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(event);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[min(760px,86vh)] max-w-[min(1080px,94vw)] flex-col gap-0 overflow-hidden border-white/10 bg-[#111014] p-0 text-white sm:max-w-[min(1080px,94vw)]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Sound library</DialogTitle>
        <DialogDescription className="sr-only">
          Search prompts that Magenta RealTime 2 understands and add them to the
          blend.
        </DialogDescription>
        <div className="flex items-center gap-3 border-white/[0.07] border-b px-4">
          <Search className="size-4 shrink-0 text-white/45" />
          <input
            aria-label="Search sounds"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-white/30"
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search ${INDEX.length} sounds: a genre, an instrument, a mood…`}
            ref={input}
            spellCheck={false}
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="flex size-7 items-center justify-center rounded-full text-white/45 hover:bg-white/[0.08] hover:text-white"
              onClick={() => {
                changeQuery("");
                input.current?.focus();
              }}
              type="button"
            >
              <X className="size-4" />
            </button>
          ) : null}
          <span className="font-mono text-[11px] text-white/35 tabular-nums">
            {tipsView ? "" : countLabel(blendView, blends.length, hits)}
          </span>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-white/[0.07] border-r p-2">
            <NavButton
              active={view === "all"}
              count={INDEX.length}
              icon={<LibraryIcon className="size-3.5" />}
              label="Everything"
              onClick={() => navigate("all")}
            />
            <NavButton
              active={view === "blends"}
              count={SESSION_PRESETS.length}
              icon={<Layers className="size-3.5" />}
              label="Starter blends"
              onClick={() => navigate("blends")}
            />
            <NavButton
              active={view === "favorites"}
              count={favorites.length}
              icon={<Star className="size-3.5" />}
              label="Favorites"
              onClick={() => navigate("favorites")}
            />
            <NavButton
              active={view === "recent"}
              count={recents.length}
              icon={<Clock className="size-3.5" />}
              label="Recent"
              onClick={() => navigate("recent")}
            />
            <NavButton
              active={tipsView}
              icon={<Lightbulb className="size-3.5" />}
              label="How to prompt"
              onClick={() => navigate("tips")}
            />
            <div className="my-2 h-px bg-white/[0.06]" />
            {LIBRARY_CATEGORIES.map((category) => (
              <NavButton
                active={view === category.id}
                count={counts.get(category.id) ?? 0}
                key={category.id}
                label={category.label}
                onClick={() => navigate(category.id)}
              />
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            {refine.length > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-3">
                <span className="text-[11px] text-white/35">Narrow</span>
                {refine.map((tag) => (
                  <button
                    className="h-6 rounded-full border border-white/[0.09] px-2.5 text-[11.5px] text-white/65 hover:border-white/30 hover:text-white"
                    key={tag}
                    onClick={() => {
                      changeQuery(`${query.trim()} ${tag}`);
                      input.current?.focus();
                    }}
                    type="button"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {tipsView ? <Tips /> : null}
              {blendView ? (
                <div className="grid grid-cols-2 gap-2">
                  {blends.map((preset, index) => (
                    <BlendCard
                      key={preset.name}
                      onApply={() => {
                        applyPreset(preset);
                        onOpenChange(false);
                      }}
                      preset={preset}
                      selected={index === cursor}
                    />
                  ))}
                </div>
              ) : null}
              {blendView || tipsView ? null : (
                <div
                  aria-label="Sounds"
                  className="flex flex-col"
                  role="listbox"
                >
                  {hits.slice(0, limit).map((hit, index) => [
                    hit.related && !hits[index - 1]?.related ? (
                      <div
                        className="mt-2 mb-1 flex items-center gap-2 px-2 text-[11px] text-white/35"
                        key="related"
                        role="presentation"
                      >
                        <span>Related</span>
                        <span className="h-px flex-1 bg-white/[0.06]" />
                      </div>
                    ) : null,
                    <ResultRow
                      added={inBlend.includes(hit.entry.text.toLowerCase())}
                      favorite={favorites.includes(hit.entry.text)}
                      full={full}
                      hit={hit}
                      key={`${hit.entry.category}-${hit.entry.text}`}
                      onSelect={() => setCursor(index)}
                      previewing={audition === hit.entry.text}
                      query={query}
                      selected={index === cursor}
                    />,
                  ])}
                </div>
              )}
              {blendView && blends.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-white/45">
                  No blend mentions “{query.trim()}”. Clear the search to see
                  all {SESSION_PRESETS.length}.
                </p>
              ) : null}
              {blendView || tipsView || hits.length > 0 ? null : (
                <EmptyResults query={query} view={view} />
              )}
              <div className="h-4" ref={sentinel} />
            </div>
          </div>
        </div>
        <footer className="flex h-10 shrink-0 items-center gap-4 border-white/[0.07] border-t px-4 text-[11px] text-white/40">
          <span>
            <Key>↑↓</Key> move
          </span>
          <span>
            <Key>Enter</Key> add
          </span>
          <span>
            <Key>Shift Enter</Key> only this
          </span>
          <span>
            <Key>Ctrl Enter</Key> add and close
          </span>
          <span className="flex-1" />
          <button
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] transition-colors",
              preview
                ? "bg-[#ff4c8d] text-white"
                : "text-white/60 hover:bg-white/[0.07] hover:text-white"
            )}
            disabled={blendView}
            onClick={togglePreview}
            type="button"
          >
            <Volume2 className="size-3.5" />
            {preview ? "Previewing as you browse" : "Preview as you browse"}
            <Key>→</Key>
          </button>
          {preview && !playing ? (
            <span className="text-amber-200/80">Press play to hear it</span>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-1 rounded border border-white/10 bg-white/[0.05] px-1 font-mono text-[10px] text-white/60">
      {children}
    </kbd>
  );
}

function EmptyResults({ query, view }: { query: string; view: View }) {
  if (view === "favorites" && !query) {
    return (
      <p className="px-4 py-10 text-center text-sm text-white/45">
        Star a sound to keep it here.
      </p>
    );
  }
  if (view === "recent" && !query) {
    return (
      <p className="px-4 py-10 text-center text-sm text-white/45">
        Sounds you add show up here.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-sm text-white/55">
        Nothing in the library matches “{query.trim()}”.
      </p>
      {query.trim() ? (
        <button
          className="flex h-8 items-center gap-1.5 rounded-full bg-white px-4 font-medium text-black text-xs"
          onClick={() => addTextPrompt(query)}
          type="button"
        >
          <Plus className="size-3.5" />
          Add “{query.trim()}” anyway
        </button>
      ) : null}
      <p className="max-w-sm text-white/35 text-xs">
        The model understands plain descriptions. Short ones with a genre, an
        instrument, or a texture work best.
      </p>
    </div>
  );
}
