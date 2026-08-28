import { describe, expect, test } from "vitest";
import { moveNoteInOrder, normalizeNoteOrder, sortNotesByOrder } from "./noteOrder";

describe("note order", () => {
  test("removes missing notes and appends newly discovered notes", () => {
    expect(normalizeNoteOrder(["c", "a", "missing"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  test("moves a note before or after another note", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveNoteInOrder(ids, ids, "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
    expect(moveNoteInOrder(ids, ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  test("sorts note objects with the saved order", () => {
    const notes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sortNotesByOrder(notes, ["c", "a", "b"]).map((note) => note.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});
