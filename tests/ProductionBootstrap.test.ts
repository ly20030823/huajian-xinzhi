import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("production bootstrap", () => {
  test("loads the Prism global before the main application entry", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const prismEntry = html.indexOf("/src/prism-bootstrap.ts");
    const mainEntry = html.indexOf("/src/main.tsx");

    expect(prismEntry).toBeGreaterThan(-1);
    expect(mainEntry).toBeGreaterThan(prismEntry);
  });

  test("registers Prism on the browser global", () => {
    const bootstrap = readFileSync(new URL("../src/prism-bootstrap.ts", import.meta.url), "utf8");

    expect(bootstrap).toContain("globalThis");
    expect(bootstrap).toContain(".Prism = Prism");
  });
});
