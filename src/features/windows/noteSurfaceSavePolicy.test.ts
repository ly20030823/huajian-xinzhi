import { describe, expect, test } from "vitest";
import {
  shouldEnterPadFromTileOnDoubleClick,
  shouldLockExistingNote,
  shouldReturnToTileAfterManualSave,
  shouldSaveBeforeSwitchingToTile,
} from "./noteSurfaceSavePolicy";

describe("note surface save policy", () => {
  test("locks an opened note until editing is explicitly unlocked", () => {
    expect(shouldLockExistingNote("note-a", false)).toBe(true);
    expect(shouldLockExistingNote("note-a", true)).toBe(false);
    expect(shouldLockExistingNote(null, false)).toBe(false);
  });

  test("keeps existing auto-save before tile switch behavior", () => {
    expect(shouldSaveBeforeSwitchingToTile(true)).toBe(true);
    expect(shouldSaveBeforeSwitchingToTile(false)).toBe(false);
  });

  test("allows double-click edit only when enabled and outside controls", () => {
    expect(shouldEnterPadFromTileOnDoubleClick(true, false)).toBe(true);
    expect(shouldEnterPadFromTileOnDoubleClick(false, false)).toBe(false);
    expect(shouldEnterPadFromTileOnDoubleClick(true, true)).toBe(false);
  });

  test("returns to tile only after manual save from a note surface", () => {
    expect(
      shouldReturnToTileAfterManualSave({
        enabled: true,
        noteId: "note-a",
        currentMode: "pad",
        isAutoSave: false,
      }),
    ).toBe(true);

    expect(
      shouldReturnToTileAfterManualSave({
        enabled: false,
        noteId: "note-a",
        currentMode: "pad",
        isAutoSave: false,
      }),
    ).toBe(false);
    expect(
      shouldReturnToTileAfterManualSave({
        enabled: true,
        noteId: "",
        currentMode: "pad",
        isAutoSave: false,
      }),
    ).toBe(false);
    expect(
      shouldReturnToTileAfterManualSave({
        enabled: true,
        noteId: "note-a",
        currentMode: "tile",
        isAutoSave: false,
      }),
    ).toBe(false);
    expect(
      shouldReturnToTileAfterManualSave({
        enabled: true,
        noteId: "note-a",
        currentMode: "pad",
        isAutoSave: true,
      }),
    ).toBe(false);
  });
});
