import { auth, signOut } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const role = (session?.user as { role?: string } | undefined)?.role;

  return (
    <AppShell userEmail={session?.user?.email} role={role} signOutAction={handleSignOut}>
      {children}
    </AppShell>
  );
}
