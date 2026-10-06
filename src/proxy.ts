import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // The Price Is Right pages (/answer, /host, /game, /api/game) use their own password gate, not Auth.js.
  matcher: ["/((?!api/auth|api/dev-login|api/game|login|privacy|answer|host|game|_next|favicon.ico).*)"],
};
