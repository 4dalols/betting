import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { hasAccess } from "@/lib/game-auth";
import { getGameView, hostCookie, playerCookie } from "@/lib/game-state";
import { normalizeCode } from "@/lib/game";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/game/[code]">) {
  if (!(await hasAccess("member"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeCode((await ctx.params).code);
  const jar = await cookies();
  const view = await getGameView(code, jar.get(playerCookie(code))?.value, jar.get(hostCookie(code))?.value);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
