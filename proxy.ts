import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySession } from "@/lib/session";

const PUBLIC_PATHS = ["/login"];

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPublic) {
    return NextResponse.next();
  }

  const authenticated = await verifySession();
  if (!authenticated) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  return NextResponse.next();
}

// Runs on every route except Next.js internals and static files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|mkq-app.js).*)"],
};
