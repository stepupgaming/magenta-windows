// Instant search over the sound library. Every word in the query has to
// match somewhere (text, tags, or category). Matches in the prompt text rank
// above tag matches, and word starts rank above the middle of a word.

export interface LibraryEntry {
  category: string;
  tags: string[];
  text: string;
}

export interface IndexedEntry extends LibraryEntry {
  compact: string;
  hay: string;
  /** Normalized prompt text. */
  plain: string;
  tagWords: string[];
  words: string[];
}

export interface SearchHit {
  entry: IndexedEntry;
  /** Matched only some of the words. Listed after the full matches. */
  related?: boolean;
  score: number;
}

/** Below this many full matches, partial matches are listed as related. */
const RELATED_BELOW = 12;

const NOT_WORD = /[^a-z0-9#]+/g;
const MARKS = /[̀-ͯ]/g;
const SPACES = /\s+/;
const WORD_CHAR = /[a-z0-9]/;
const DRUM_AND_BASS = /\bd\s*(&|n)\s*b\b/gi;

/** Common shorthand people type, expanded before matching. */
const ALIASES: Record<string, string> = {
  bpm: "",
  dnb: "drum and bass",
  edm: "dance electronic",
  hiphop: "hip hop",
  lofi: "lo fi",
  rnb: "r and b",
  synthpop: "synth pop",
  vgm: "video game",
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(MARKS, "")
    .replace(NOT_WORD, " ")
    .trim();
}

export function tokenize(query: string): string[] {
  const words: string[] = [];
  const expanded = query.replace(DRUM_AND_BASS, "drum and bass");
  for (const raw of normalize(expanded).split(SPACES)) {
    if (!raw) {
      continue;
    }
    const alias = ALIASES[raw];
    if (alias === undefined) {
      words.push(raw);
    } else if (alias) {
      words.push(...alias.split(" "));
    }
  }
  return [...new Set(words)];
}

export function indexEntries(
  entries: LibraryEntry[],
  categoryLabel: (id: string) => string
): IndexedEntry[] {
  return entries.map((entry) => {
    const plain = normalize(entry.text);
    const tagWords = entry.tags.flatMap((tag) => normalize(tag).split(" "));
    const hay = `${plain} ${tagWords.join(" ")} ${normalize(categoryLabel(entry.category))}`;
    return {
      ...entry,
      compact: hay.replaceAll(" ", ""),
      hay,
      plain,
      tagWords,
      words: plain.split(" "),
    };
  });
}

function tokenScore(entry: IndexedEntry, token: string): number {
  if (entry.words.includes(token)) {
    return 12;
  }
  if (entry.words.some((word) => word.startsWith(token))) {
    return 9;
  }
  if (entry.plain.includes(token)) {
    return 6;
  }
  if (entry.tagWords.includes(token)) {
    return 5;
  }
  if (entry.tagWords.some((word) => word.startsWith(token))) {
    return 4;
  }
  if (entry.hay.includes(token)) {
    return 2;
  }
  if (token.length > 3 && entry.compact.includes(token)) {
    return 1;
  }
  return 0;
}

export function search(
  entries: IndexedEntry[],
  query: string,
  category: string | null
): SearchHit[] {
  const tokens = tokenize(query);
  const pool = category
    ? entries.filter((entry) => entry.category === category)
    : entries;
  if (tokens.length === 0) {
    return pool.map((entry) => ({ entry, score: 0 }));
  }
  const phrase = tokens.join(" ");
  const hits: SearchHit[] = [];
  const partial: SearchHit[] = [];
  for (const entry of pool) {
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const value = tokenScore(entry, token);
      score += value;
      matched += value > 0 ? 1 : 0;
    }
    if (matched === 0) {
      continue;
    }
    // Shorter prompts are more direct matches for the same words.
    score -= entry.words.length * 0.3;
    if (matched < tokens.length) {
      partial.push({ entry, related: true, score: score + matched * 4 });
      continue;
    }
    if (entry.plain.startsWith(phrase)) {
      score += 14;
    } else if (entry.plain.includes(phrase)) {
      score += 6;
    }
    hits.push({ entry, score });
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length >= RELATED_BELOW || tokens.length < 2) {
    return hits;
  }
  partial.sort((a, b) => b.score - a.score);
  return [...hits, ...partial.slice(0, 60)];
}

/** Character ranges of `text` that match the query, for highlighting. */
export function highlight(text: string, query: string): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of tokenize(query)) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(token, from);
      if (at < 0) {
        break;
      }
      const startsWord = at === 0 || !WORD_CHAR.test(lower[at - 1] ?? "");
      if (startsWord) {
        ranges.push([at, at + token.length]);
      }
      from = at + token.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

/** Most common tags in a result set, for the refine chips. */
export function topTags(
  hits: SearchHit[],
  exclude: string[],
  count: number
): string[] {
  const tally = new Map<string, number>();
  for (const hit of hits) {
    for (const tag of hit.entry.tags) {
      if (!exclude.includes(tag)) {
        tally.set(tag, (tally.get(tag) ?? 0) + 1);
      }
    }
  }
  return [...tally.entries()]
    .filter(([, total]) => total > 1 && total < hits.length)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([tag]) => tag);
}
