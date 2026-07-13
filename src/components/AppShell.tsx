import Sidebar from "@/components/Sidebar";
import ExcelCellFocus from "@/components/ExcelCellFocus";
import RowSelect from "@/components/RowSelect";

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
      <main className="min-w-0 flex-1 bg-background">{children}</main>
      <ExcelCellFocus />
      <RowSelect />
    </div>
  );
}
