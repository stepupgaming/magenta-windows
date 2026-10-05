import { describe, expect, it } from "vitest";
import { MODEL_DEFAULTS, migrateStudioSettings } from "./store.ts";
import type { Scene } from "./types.ts";

const savedScene = (styleDetail?: number) =>
  ({ prompts: [], styleDetail }) as unknown as Scene;

describe("migrateStudioSettings", () => {
  it("moves the old default of 6 style tokens to all 12", () => {
    const migrated = migrateStudioSettings({ styleDetail: 6 }, 1);
    expect(MODEL_DEFAULTS.styleDetail).toBe(12);
    expect(migrated.styleDetail).toBe(12);
  });

  it("keeps a style detail someone chose", () => {
    expect(migrateStudioSettings({ styleDetail: 4 }, 1).styleDetail).toBe(4);
    expect(migrateStudioSettings({ temperature: 1.2 }, 1)).toEqual({
      temperature: 1.2,
    });
  });

  it("moves saved scenes the same way and keeps empty slots", () => {
    const scenes = migrateStudioSettings(
      { scenes: [savedScene(6), null, savedScene(9), savedScene()] },
      1
    ).scenes;
    expect(scenes?.map((scene) => scene?.styleDetail ?? null)).toEqual([
      12,
      null,
      9,
      null,
    ]);
  });

  it("leaves current settings alone", () => {
    expect(migrateStudioSettings({ styleDetail: 6 }, 2).styleDetail).toBe(6);
  });
});
