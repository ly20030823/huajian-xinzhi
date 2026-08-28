import type { TileColorMode } from "./types";

export const DEFAULT_TILE_COLOR = "#f6f3ec";
export const SYSTEM_TILE_COLOR_LIGHT = "#f6f3ec";
export const SYSTEM_TILE_COLOR_WHITE = "#ffffff";
export const SYSTEM_TILE_COLOR_DARK = "#191919";

const FULL_HEX_COLOR = /^#?([0-9a-fA-F]{6})$/;
const SHORT_HEX_COLOR = /^#?([0-9a-fA-F]{3})$/;

export function normalizeTileColor(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  const fullMatch = trimmed.match(FULL_HEX_COLOR);
  if (fullMatch) {
    return `#${fullMatch[1].toLowerCase()}`;
  }

  const shortMatch = trimmed.match(SHORT_HEX_COLOR);
  if (shortMatch) {
    return `#${shortMatch[1]
      .split("")
      .map((character) => character + character)
      .join("")
      .toLowerCase()}`;
  }

  return DEFAULT_TILE_COLOR;
}

export function tileColorForTheme(theme: string | null | undefined): string {
  if (theme === "dark") return SYSTEM_TILE_COLOR_DARK;
  if (theme === "white") return SYSTEM_TILE_COLOR_WHITE;
  return SYSTEM_TILE_COLOR_LIGHT;
}

export function resolveSystemTileColor(): string {
  if (typeof document === "undefined") return SYSTEM_TILE_COLOR_LIGHT;
  return tileColorForTheme(document.documentElement.getAttribute("data-theme"));
}

export function resolveTileColor(mode: TileColorMode, customColor: string): string {
  return mode === "system" ? resolveSystemTileColor() : normalizeTileColor(customColor);
}
