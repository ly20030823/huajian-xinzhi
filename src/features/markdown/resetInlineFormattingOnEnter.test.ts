import { describe, expect, test } from "vitest";
import { isCurrentQuoteLineEmpty } from "./resetInlineFormattingOnEnter";

describe("quote line continuation", () => {
  test("continues a quote while the current line contains text", () => {
    expect(isCurrentQuoteLineEmpty("引用内容", "")).toBe(false);
    expect(isCurrentQuoteLineEmpty("上一行\n当前", "行")).toBe(false);
  });

  test("exits only from an empty quote line", () => {
    expect(isCurrentQuoteLineEmpty("引用内容\n", "")).toBe(true);
    expect(isCurrentQuoteLineEmpty("引用内容\n  ", "")).toBe(true);
  });
});
