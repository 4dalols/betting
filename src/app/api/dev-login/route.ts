import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

/** Local-only login bypass for testing without Google OAuth. Never enabled in production. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_LOGIN_ENABLED !== "true") {
    return new NextResponse("Not found", { status: 404 });
  }
  const email = request.nextUrl.searchParams.get("email");
  if (!email) return new NextResponse("email required", { status: 400 });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: email.split("@")[0] },
  });
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 30 * 86400_000) },
  });
  const res = NextResponse.redirect(new URL("/", request.url));
  res.cookies.set("authjs.session-token", sessionToken, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
