import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export type GateRole = "member" | "host";

const COOKIE: Record<GateRole, string> = { member: "pir_member", host: "pir_host" };
const MAX_AGE = 180 * 86400;

function secret() {
  return process.env.AUTH_SECRET ?? "dev-secret";
}

function passwordFor(role: GateRole): string {
  const member = process.env.GAME_PASSWORD ?? "";
  if (role === "member") return member;
  return process.env.GAME_HOST_PASSWORD || member;
}

/** Cookie value derived from the password, so rotating the password logs everyone out. */
function tokenFor(role: GateRole, password: string) {
  return createHmac("sha256", secret()).update(`${role}:${password}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function gateConfigured(): boolean {
  return Boolean(process.env.GAME_PASSWORD);
}

export async function hasAccess(role: GateRole): Promise<boolean> {
  const pw = passwordFor(role);
  if (!pw) return false;
  const jar = await cookies();
  const cookie = jar.get(COOKIE[role])?.value;
  if (cookie && safeEqual(cookie, tokenFor(role, pw))) return true;
  if (role === "member") {
    // A host cookie also grants member access.
    const hostCookie = jar.get(COOKIE.host)?.value;
    if (hostCookie && safeEqual(hostCookie, tokenFor("host", passwordFor("host")))) return true;
  }
  return false;
}

/** Verifies the password and sets the access cookie. Returns false on a wrong password. */
export async function grantAccess(role: GateRole, attempt: string): Promise<boolean> {
  const pw = passwordFor(role);
  if (!pw || !safeEqual(attempt, pw)) return false;
  const jar = await cookies();
  jar.set(COOKIE[role], tokenFor(role, pw), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  return true;
}

export async function requireAccess(role: GateRole) {
  if (!(await hasAccess(role))) throw new Error(role === "host" ? "Host password required" : "Group password required");
}
