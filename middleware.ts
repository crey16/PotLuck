import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (FastAPI owns /api/*, including the dev rewrite to uvicorn —
     *   Next middleware must never intercept it)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - common image extensions
     */
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
