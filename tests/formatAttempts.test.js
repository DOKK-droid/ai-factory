import { describe, it, expect } from "node:test";
import { formatAttempts } from "../src/formatAttempts.js";

describe("formatAttempts", () => {
  it("devuelve attempts/max cuando attempts es menor que max", () => {
    expect(formatAttempts(2, 5)).toBe("2/5");
  });

  it("devuelve max/max cuando attempts excede max", () => {
    expect(formatAttempts(9, 5)).toBe("5/5");
  });

  it("usa max por defecto de 5", () => {
    expect(formatAttempts(3)).toBe("3/5");
  });

  it("devuelve 0/5 cuando attempts es 0", () => {
    expect(formatAttempts(0, 5)).toBe("0/5");
  });
});
