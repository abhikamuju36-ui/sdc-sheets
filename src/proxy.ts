export { auth as proxy } from "@/lib/auth";

export const config = {
  // api/integration is exempt from the browser NextAuth session: those routes
  // are server-to-server (called by SDC_Scheduler) and enforce their own
  // SCHEDULER_SHARED_TOKEN bearer guard, which fails closed when unset.
  matcher: ["/((?!login|api/auth|api/integration|_next/static|_next/image|favicon.ico|brand/).*)"],
};
