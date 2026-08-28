import { describe, expect, test } from "vitest";
import { parseGreetings, pickGreeting, pickNextGreeting, renderAboutMarkdown } from "./content";

describe("customization content", () => {
  test("reads unordered list items as greetings", () => {
    expect(
      parseGreetings(`# 问候\n\n- 你好\n* 慢慢写，也很好\n+ 今天也记下一点吧\n\n普通说明`),
    ).toEqual(["你好", "慢慢写，也很好", "今天也记下一点吧"]);
  });

  test("selects a greeting with the supplied random source", () => {
    const greetings = ["第一句", "第二句", "第三句"];
    expect(pickGreeting(greetings, () => 0)).toBe("第一句");
    expect(pickGreeting(greetings, () => 0.99)).toBe("第三句");
    expect(pickGreeting([], () => 0)).toBeNull();
  });

  test("selects a different greeting when switching notes", () => {
    const greetings = ["第一句", "第二句", "第三句"];
    expect(pickNextGreeting(greetings, "第一句", () => 0)).toBe("第二句");
    expect(pickNextGreeting(["只有一句"], "只有一句", () => 0)).toBe("只有一句");
    expect(pickNextGreeting([], "", () => 0)).toBeNull();
  });

  test("fills dynamic about placeholders", () => {
    expect(renderAboutMarkdown("版本 v{{version}} · {{year}}", "1.2.3", 2026)).toBe(
      "版本 v1.2.3 · 2026",
    );
  });
});
