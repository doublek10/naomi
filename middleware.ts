import { withAuth } from "next-auth/middleware";

// Protects everything under the (dashboard) route group. The KCB webhook and
// cron routes live under /api and are intentionally NOT covered — they use
// their own bearer-token / IP-allowlist checks instead (see
// app/api/webhooks/kcb/route.ts and app/api/cron/*).
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/rooms/:path*",
    "/tenants/:path*",
    "/rent/:path*",
    "/water-billing/:path*",
    "/invoices/:path*",
    "/expenses/:path*",
    "/settings/:path*",
  ],
};
