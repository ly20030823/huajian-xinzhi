import { describe, expect, test } from "vitest";
import { calculateContainedScrollTop } from "./scrollWithinContainer";

describe("calculateContainedScrollTop", () => {
  test("centers a heading inside its own editor viewport", () => {
    expect(
      calculateContainedScrollTop({
        currentScrollTop: 400,
        viewportHeight: 600,
        scrollHeight: 3000,
        targetTop: 800,
        targetHeight: 40,
        block: "center",
      }),
    ).toBe(920);
  });

  test("clamps the result without scrolling an outer document", () => {
    expect(
      calculateContainedScrollTop({
        currentScrollTop: 0,
        viewportHeight: 600,
        scrollHeight: 1000,
        targetTop: 950,
        targetHeight: 30,
        block: "center",
      }),
    ).toBe(400);
  });
});
