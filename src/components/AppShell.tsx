import Sidebar from "@/components/Sidebar";

export default function AppShell({
  children,
  userEmail,
  signOutAction,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar userEmail={userEmail} signOutAction={signOutAction} />
      <main className="flex-1 bg-background">{children}</main>
    </div>
  );
}
