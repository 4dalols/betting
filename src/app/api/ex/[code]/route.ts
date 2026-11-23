import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { hasAccess } from "@/lib/game-auth";
import { getExView, exHostCookie, exPlayerCookie } from "@/lib/ex-state";
import { normalizeCode } from "@/lib/game";

/** `?chart=` / `?pnl=`: last second the client already has; only later points are sent. */
const sinceParam = (v: string | null) => {
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : undefined;
};

export async function GET(request: NextRequest, ctx: RouteContext<"/api/ex/[code]">) {
  if (!(await hasAccess("member"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeCode((await ctx.params).code);
  const jar = await cookies();
  const view = await getExView(code, jar.get(exPlayerCookie(code))?.value, jar.get(exHostCookie(code))?.value, {
    chart: sinceParam(request.nextUrl.searchParams.get("chart")),
    pnl: sinceParam(request.nextUrl.searchParams.get("pnl")),
  });
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}
