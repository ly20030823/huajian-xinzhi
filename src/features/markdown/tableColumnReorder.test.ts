import { describe, expect, it } from "vitest";
import { reorderTableColumn } from "./tableColumnReorder";

describe("reorderTableColumn", () => {
  it("moves every cell and its alignment as one column", () => {
    const table = {
      children: [{ children: ["A", "B", "C"] }, { children: ["1", "2", "3"] }],
      align: ["left", "center", "right"],
    };

    expect(reorderTableColumn(table, 0, 2)).toBe(true);
    expect(table.children).toEqual([{ children: ["B", "C", "A"] }, { children: ["2", "3", "1"] }]);
    expect(table.align).toEqual(["center", "right", "left"]);
  });

  it("does not change the table for an invalid or unchanged destination", () => {
    const table = { children: [{ children: ["A", "B"] }] };

    expect(reorderTableColumn(table, 1, 1)).toBe(false);
    expect(reorderTableColumn(table, 1, 3)).toBe(false);
    expect(table.children[0].children).toEqual(["A", "B"]);
  });
});
