import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { hasAccess } from "@/lib/game-auth";
import { getTtView, ttHostCookie, ttPlayerCookie } from "@/lib/tt-state";
import { normalizeCode } from "@/lib/game";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tt/[code]">) {
  if (!(await hasAccess("member"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeCode((await ctx.params).code);
  const jar = await cookies();
  const view = await getTtView(code, jar.get(ttPlayerCookie(code))?.value, jar.get(ttHostCookie(code))?.value);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
