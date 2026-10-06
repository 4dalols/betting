import { describe, expect, it } from "vitest";
import { normalizeCode, randomCode, roundWinners } from "./game";

const g = (playerId: string, value: number) => ({ playerId, value });

describe("roundWinners", () => {
  it("picks the closest without going over", () => {
    expect(roundWinners([g("a", 10), g("b", 14), g("c", 16)], 15, "CLOSEST_WITHOUT_OVER")).toEqual(["b"]);
  });
  it("nobody scores when everyone is over", () => {
    expect(roundWinners([g("a", 20), g("b", 16)], 15, "CLOSEST_WITHOUT_OVER")).toEqual([]);
  });
  it("exact answer wins", () => {
    expect(roundWinners([g("a", 15), g("b", 14)], 15, "CLOSEST_WITHOUT_OVER")).toEqual(["a"]);
  });
  it("ties all score", () => {
    expect(roundWinners([g("a", 14), g("b", 14), g("c", 1)], 15, "CLOSEST_WITHOUT_OVER")).toEqual(["a", "b"]);
    expect(roundWinners([g("a", 14), g("b", 16)], 15, "CLOSEST")).toEqual(["a", "b"]);
  });
  it("closest mode allows going over", () => {
    expect(roundWinners([g("a", 10), g("b", 16)], 15, "CLOSEST")).toEqual(["b"]);
  });
  it("no guesses, no winners", () => {
    expect(roundWinners([], 15, "CLOSEST")).toEqual([]);
  });
});

describe("codes", () => {
  it("generates codes from the unambiguous alphabet", () => {
    const code = randomCode(6, () => 0.999);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });
  it("normalizes user input", () => {
    expect(normalizeCode(" ab-cd ")).toBe("ABCD");
  });
});
