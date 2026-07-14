export { auth as proxy } from "@/lib/auth";

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|brand/).*)"],
};
