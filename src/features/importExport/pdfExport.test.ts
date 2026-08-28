import { describe, expect, it } from "vitest";
import { normalizePdfColorFunctions } from "./pdfExport";

describe("normalizePdfColorFunctions", () => {
  it("converts oklab colors to html2canvas-compatible rgba colors", () => {
    const result = normalizePdfColorFunctions("oklab(0.62 0.04 -0.08 / 0.7)");

    expect(result).toMatch(/^rgba\(\d+, \d+, \d+, 0\.7\)$/);
    expect(result).not.toContain("oklab");
  });

  it("converts oklch colors embedded in a longer CSS value", () => {
    const result = normalizePdfColorFunctions(
      "0 1px 3px oklch(0.72 0.12 250 / 0.35), 0 0 0 rgb(0, 0, 0)",
    );

    expect(result).toContain("rgba(");
    expect(result).not.toContain("oklch");
    expect(result).toContain("rgb(0, 0, 0)");
  });

  it("leaves already compatible colors unchanged", () => {
    const value = "1px solid rgba(37, 99, 235, 0.5)";

    expect(normalizePdfColorFunctions(value)).toBe(value);
  });
});
