import { describe, expect, test } from "vitest";
import { moveCategoryInOrder, normalizeCategoryOrder } from "./categoryOrder";

describe("category order", () => {
  test("keeps saved folders and appends newly discovered folders", () => {
    expect(normalizeCategoryOrder(["旅行", "工作", "已删除"], ["工作", "日常", "旅行"])).toEqual([
      "旅行",
      "工作",
      "日常",
    ]);
  });

  test("moves a folder before or after another folder", () => {
    const categories = ["一", "二", "三", "四"];
    expect(moveCategoryInOrder(categories, categories, "四", "二", "before")).toEqual([
      "一",
      "四",
      "二",
      "三",
    ]);
    expect(moveCategoryInOrder(categories, categories, "一", "三", "after")).toEqual([
      "二",
      "三",
      "一",
      "四",
    ]);
  });
});
