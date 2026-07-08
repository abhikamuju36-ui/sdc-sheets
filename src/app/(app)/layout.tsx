import { auth, signOut } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell userEmail={session?.user?.email} signOutAction={handleSignOut}>
      {children}
    </AppShell>
  );
}
