import type { ScoringMode } from "@/generated/prisma/client";

export type GuessLike = { playerId: string; value: number };

/**
 * Price Is Right scoring. Returns the ids of the players who score a point this round.
 * CLOSEST_WITHOUT_OVER: nearest guess that does not exceed the answer (nobody scores if everyone is over).
 * CLOSEST: nearest guess in either direction. Ties all score.
 */
export function roundWinners(guesses: GuessLike[], answer: number, mode: ScoringMode): string[] {
  const eligible = mode === "CLOSEST_WITHOUT_OVER" ? guesses.filter((g) => g.value <= answer) : guesses;
  if (eligible.length === 0) return [];
  const best = Math.min(...eligible.map((g) => Math.abs(answer - g.value)));
  return eligible.filter((g) => Math.abs(answer - g.value) === best).map((g) => g.playerId);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length = 4, rand: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return out;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export const scoringLabel: Record<ScoringMode, string> = {
  CLOSEST_WITHOUT_OVER: "Closest without going over",
  CLOSEST: "Closest guess wins",
};
