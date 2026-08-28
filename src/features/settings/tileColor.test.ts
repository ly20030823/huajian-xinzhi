import { describe, expect, test } from "vitest";
import {
  DEFAULT_TILE_COLOR,
  SYSTEM_TILE_COLOR_DARK,
  SYSTEM_TILE_COLOR_LIGHT,
  SYSTEM_TILE_COLOR_WHITE,
  normalizeTileColor,
  tileColorForTheme,
} from "./tileColor";

describe("tile color settings", () => {
  test("normalizes full and shorthand hex colors", () => {
    expect(normalizeTileColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeTileColor("abc")).toBe("#aabbcc");
  });

  test("falls back to the default tile color for invalid values", () => {
    expect(DEFAULT_TILE_COLOR).toBe("#f6f3ec");
    expect(normalizeTileColor("")).toBe(DEFAULT_TILE_COLOR);
    expect(normalizeTileColor("#12zz99")).toBe(DEFAULT_TILE_COLOR);
  });

  test("uses a distinct tile color for every app theme", () => {
    expect(tileColorForTheme("light")).toBe(SYSTEM_TILE_COLOR_LIGHT);
    expect(tileColorForTheme("white")).toBe(SYSTEM_TILE_COLOR_WHITE);
    expect(tileColorForTheme("dark")).toBe(SYSTEM_TILE_COLOR_DARK);
    expect(tileColorForTheme(null)).toBe(SYSTEM_TILE_COLOR_LIGHT);
  });
});
