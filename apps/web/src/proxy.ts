import { type NextRequest, NextResponse } from "next/server";

/**
 * UX-only redirect for signed-out visitors. Real authorization always happens in the
 * Django API; this never grants anything.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("hayat_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/print/:path*"],
};
