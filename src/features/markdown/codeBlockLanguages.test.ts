import { describe, expect, test } from "vitest";
import {
  CODE_LANGUAGE_OPTIONS,
  detectCodeLanguage,
  filterCodeLanguages,
  findCodeLanguage,
} from "./codeBlockLanguages";

describe("code block languages", () => {
  test("exposes the complete CodeMirror language catalog", () => {
    expect(CODE_LANGUAGE_OPTIONS.length).toBeGreaterThan(140);
    expect(findCodeLanguage("js")?.name).toBe("JavaScript");
    expect(findCodeLanguage("py")?.name).toBe("Python");
  });

  test("filters by names, aliases, and extensions", () => {
    expect(filterCodeLanguages("py").some((language) => language.name === "Python")).toBe(true);
    expect(filterCodeLanguages("tsx").some((language) => language.name === "TSX")).toBe(true);
  });

  test("detects common code when a fence has no useful language", () => {
    expect(detectCodeLanguage("gate_id:\ndecision: GO\nmetrics:\n")).toBe("yaml");
    expect(detectCodeLanguage("const answer = 42;\nconsole.log(answer);")).toBe("javascript");
    expect(detectCodeLanguage("def hello(name):\n    print(name)")).toBe("python");
  });
});
