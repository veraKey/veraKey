import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { textOf } from "./text";

describe("textOf", () => {
  it("flattens strings, numbers, arrays and elements", () => {
    const node = ["Pay ", createElement("code", null, "pay()"), " in ", 2, " steps"];
    expect(textOf(node)).toBe("Pay pay() in 2 steps");
  });
  it("ignores booleans and null", () => {
    expect(textOf([false, null, "x", undefined, true])).toBe("x");
  });
});
