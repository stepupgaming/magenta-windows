import { describe, expect, it } from "vitest";
import {
  highlight,
  indexEntries,
  search,
  tokenize,
  topTags,
} from "./library-search.ts";

const entries = indexEntries(
  [
    {
      category: "genres",
      tags: ["electronic", "dnb", "uptempo"],
      text: "liquid drum and bass",
    },
    {
      category: "genres",
      tags: ["chill", "beats"],
      text: "lo-fi hip hop beat",
    },
    {
      category: "instruments",
      tags: ["keys", "electric piano"],
      text: "warm rhodes electric piano",
    },
    { category: "instruments", tags: ["keys", "acoustic"], text: "felt piano" },
    { category: "moods", tags: ["calm", "chill"], text: "dreamy" },
  ],
  (id) =>
    ({ genres: "Genres", instruments: "Instruments", moods: "Moods" })[id] ?? id
);

const texts = (query: string, category: string | null = null) =>
  search(entries, query, category).map((hit) => hit.entry.text);

describe("tokenize", () => {
  it("expands shorthand", () => {
    expect(tokenize("dnb")).toEqual(["drum", "and", "bass"]);
    expect(tokenize("D&B")).toEqual(["drum", "and", "bass"]);
    expect(tokenize("lofi")).toEqual(["lo", "fi"]);
  });
});

describe("search", () => {
  it("returns everything for an empty query", () => {
    expect(texts("")).toHaveLength(5);
  });

  it("lists full matches first, then related ones", () => {
    const hits = search(entries, "piano warm", null);
    expect(hits[0]?.entry.text).toBe("warm rhodes electric piano");
    expect(hits[0]?.related).toBeUndefined();
    expect(hits.slice(1).every((hit) => hit.related)).toBe(true);
    expect(hits.map((hit) => hit.entry.text)).toContain("felt piano");
  });

  it("drops entries that match none of the words", () => {
    expect(texts("piano warm")).not.toContain("dreamy");
  });

  it("ranks a short direct match first", () => {
    expect(texts("piano")[0]).toBe("felt piano");
  });

  it("finds by tag and by shorthand", () => {
    expect(texts("keys")).toHaveLength(2);
    expect(texts("lofi")[0]).toBe("lo-fi hip hop beat");
    expect(texts("dnb")[0]).toBe("liquid drum and bass");
  });

  it("matches word starts", () => {
    expect(texts("rho")).toEqual(["warm rhodes electric piano"]);
  });

  it("filters by category", () => {
    expect(texts("chill", "moods")).toEqual(["dreamy"]);
  });
});

describe("highlight", () => {
  it("marks word starts only and merges overlaps", () => {
    expect(highlight("warm rhodes electric piano", "pi rho")).toEqual([
      [5, 8],
      [21, 23],
    ]);
    expect(highlight("spinning", "pin")).toEqual([]);
  });
});

describe("topTags", () => {
  it("suggests tags that split the results", () => {
    const hits = search(entries, "", null);
    expect(topTags(hits, [], 3)).toEqual(["chill", "keys"]);
  });
});
