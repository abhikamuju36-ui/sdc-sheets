import Sidebar from "@/components/Sidebar";

export default function AppShell({
  children,
  userEmail,
  role,
  signOutAction,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
  role?: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar userEmail={userEmail} role={role} signOutAction={signOutAction} />
      <main className="flex-1 bg-background">{children}</main>
    </div>
  );
}
