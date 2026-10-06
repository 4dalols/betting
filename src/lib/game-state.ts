import { prisma } from "@/lib/db";
import type { GameStatus, ScoringMode } from "@/generated/prisma/client";

export type PlayerView = { id: string; name: string; score: number; guessed: boolean };

export type RoundView = {
  id: string;
  index: number;
  prompt: string;
  unit: string | null;
  revealed: boolean;
  answerSum: number | null;
  answered: number | null;
  skipped: number | null;
  /** Only populated once the round is revealed (or for the viewer's own guess). */
  guesses: { playerId: string; name: string; value: number; points: number }[];
  myGuess: number | null;
};

export type GameView = {
  code: string;
  status: GameStatus;
  scoring: ScoringMode;
  totalRounds: number;
  currentRound: number;
  isHost: boolean;
  me: { id: string; name: string } | null;
  players: PlayerView[];
  round: RoundView | null;
  history: { index: number; prompt: string; answerSum: number; winners: string[] }[];
};

export const gameInclude = {
  players: { orderBy: { joinedAt: "asc" as const }, include: { guesses: { select: { points: true, roundId: true } } } },
  rounds: {
    orderBy: { index: "asc" as const },
    include: { question: { select: { prompt: true, unit: true } }, guesses: { include: { player: { select: { name: true } } } } },
  },
} as const;

export async function getGameView(code: string, playerToken?: string, hostToken?: string): Promise<GameView | null> {
  const game = await prisma.game.findUnique({ where: { code }, include: gameInclude });
  if (!game) return null;
  const isHost = Boolean(hostToken) && game.hostToken === hostToken;
  const me = playerToken ? game.players.find((p) => p.token === playerToken) : undefined;
  const current = game.rounds[game.currentRound] ?? null;

  const players: PlayerView[] = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.guesses.reduce((s, g) => s + g.points, 0),
    guessed: current ? current.guesses.some((g) => g.playerId === p.id) : false,
  }));

  let round: RoundView | null = null;
  if (current && game.status !== "LOBBY") {
    const revealed = current.revealedAt !== null;
    const mine = me ? current.guesses.find((g) => g.playerId === me.id) : undefined;
    round = {
      id: current.id,
      index: current.index,
      prompt: current.question.prompt,
      unit: current.question.unit,
      revealed,
      answerSum: revealed ? current.answerSum : null,
      answered: revealed ? current.answered : null,
      skipped: revealed ? current.skipped : null,
      guesses: revealed
        ? current.guesses
            .map((g) => ({ playerId: g.playerId, name: g.player.name, value: g.value, points: g.points }))
            .sort((a, b) => b.value - a.value)
        : [],
      myGuess: mine?.value ?? null,
    };
  }

  const history = game.rounds
    .filter((r) => r.revealedAt !== null && r.index < game.currentRound)
    .map((r) => ({
      index: r.index,
      prompt: r.question.prompt,
      answerSum: r.answerSum ?? 0,
      winners: r.guesses.filter((g) => g.points > 0).map((g) => g.player.name),
    }));

  return {
    code: game.code,
    status: game.status,
    scoring: game.scoring,
    totalRounds: game.rounds.length,
    currentRound: game.currentRound,
    isHost,
    me: me ? { id: me.id, name: me.name } : null,
    players,
    round,
    history,
  };
}

export const playerCookie = (code: string) => `pir_player_${code}`;
export const hostCookie = (code: string) => `pir_host_${code}`;
