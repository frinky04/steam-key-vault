import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "sk_session";

// Cheap gate: anything outside the public routes needs a session cookie.
// Real validation (DB lookup, role checks) happens in layouts and server actions.
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && token.length >= 20) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = request.nextUrl.pathname !== "/" ? `?next=${encodeURIComponent(request.nextUrl.pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Skip: public pages, Next internals, and files with an extension (icon etc.)
    "/((?!login|setup|invite/|claim/|api/health|_next/|.*\\..*).*)",
  ],
};
