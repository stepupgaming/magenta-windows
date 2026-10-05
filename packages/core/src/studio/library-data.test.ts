import { describe, expect, it } from "vitest";
import {
  LIBRARY_BLENDS,
  LIBRARY_CATEGORIES,
  LIBRARY_PROMPTS,
} from "./library-data.ts";
import { indexEntries, normalize, search } from "./library-search.ts";

const NEGATION = /\b(no|not|without|non)\b/;
const index = indexEntries(LIBRARY_PROMPTS, (id) => id);
const first = (query: string) => search(index, query, null)[0]?.entry.text;

describe("library data", () => {
  it("holds several hundred unique prompts", () => {
    expect(LIBRARY_PROMPTS.length).toBeGreaterThan(800);
    const keys = LIBRARY_PROMPTS.map((entry) =>
      normalize(entry.text).replaceAll(" ", "")
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("files every prompt under a known category with tags", () => {
    const ids = new Set(LIBRARY_CATEGORIES.map((category) => category.id));
    for (const entry of LIBRARY_PROMPTS) {
      expect(ids.has(entry.category)).toBe(true);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(entry.text).toBe(entry.text.toLowerCase());
    }
  });

  it("never asks for an absence, which the model hears as presence", () => {
    expect(
      LIBRARY_PROMPTS.filter((entry) => NEGATION.test(entry.text))
    ).toEqual([]);
  });

  it("builds blends only from library prompts", () => {
    const texts = new Set(LIBRARY_PROMPTS.map((entry) => entry.text));
    for (const blend of LIBRARY_BLENDS) {
      expect(blend.prompts.length).toBeGreaterThan(1);
      for (const [text, weight] of blend.prompts) {
        expect(texts.has(text)).toBe(true);
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    }
  });

  it("answers common searches sensibly", () => {
    expect(first("dnb")).toContain("drum and bass");
    expect(first("lofi")).toContain("lo-fi");
    expect(first("cello")).toContain("cello");
    expect(search(index, "dark ambient", null).length).toBeGreaterThan(0);
  });
});
