import { describe, expect, it } from "vitest";
import { computePayouts } from "./payout";

describe("computePayouts", () => {
  it("pays (y+n)*x/y to each winner", () => {
    const bets = [
      { userId: "a", outcomeId: "yes", amountCents: 500 },
      { userId: "b", outcomeId: "yes", amountCents: 500 },
      { userId: "c", outcomeId: "no", amountCents: 500 },
      { userId: "d", outcomeId: "no", amountCents: 500 },
      { userId: "e", outcomeId: "no", amountCents: 500 },
    ];
    expect(computePayouts(bets, "yes")).toEqual([
      { userId: "a", amountCents: 1250 },
      { userId: "b", amountCents: 1250 },
    ]);
  });

  it("conserves the pool exactly when division is uneven", () => {
    const bets = [
      { userId: "a", outcomeId: "yes", amountCents: 100 },
      { userId: "b", outcomeId: "yes", amountCents: 100 },
      { userId: "c", outcomeId: "yes", amountCents: 100 },
      { userId: "d", outcomeId: "no", amountCents: 100 },
    ];
    const out = computePayouts(bets, "yes");
    expect(out.reduce((s, p) => s + p.amountCents, 0)).toBe(400);
    expect(out.map((p) => p.amountCents).sort()).toEqual([133, 133, 134]);
  });

  it("returns nothing when no one bet on the winner", () => {
    expect(
      computePayouts([{ userId: "a", outcomeId: "no", amountCents: 100 }], "yes"),
    ).toEqual([]);
  });

  it("returns stake back when everyone picked the winner", () => {
    const bets = [
      { userId: "a", outcomeId: "yes", amountCents: 300 },
      { userId: "b", outcomeId: "yes", amountCents: 300 },
    ];
    expect(computePayouts(bets, "yes")).toEqual([
      { userId: "a", amountCents: 300 },
      { userId: "b", amountCents: 300 },
    ]);
  });
});
