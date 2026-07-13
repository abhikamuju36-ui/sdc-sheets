import { PageTitle } from "@/components/ui/Typography";
import { isStandardSheetUnlocked, hadWrongPassword, unlockStandardSheet } from "@/lib/standard-sheet-gate";

export default async function StandardSheetLayout({ children }: { children: React.ReactNode }) {
  const [unlocked, wrongPassword] = await Promise.all([isStandardSheetUnlocked(), hadWrongPassword()]);

  if (!unlocked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <form action={unlockStandardSheet} className="w-full max-w-sm rounded-lg border border-sdc-border bg-white p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold text-sdc-navy">Standard Sheet is protected</h2>
          <p className="mt-1 text-sm text-sdc-gray-400">Enter the password to view this tab.</p>
          <input
            type="password"
            name="password"
            autoFocus
            className="mt-4 w-full rounded-md border border-sdc-border px-3 py-2 text-sm outline-none focus:border-sdc-blue-light"
            placeholder="Password"
          />
          {wrongPassword && <p className="mt-2 text-xs text-red-600">Incorrect password.</p>}
          <button
            type="submit"
            className="mt-4 w-full rounded-md bg-sdc-navy px-3 py-2 text-sm font-medium text-white hover:bg-sdc-navy/90"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full p-8">
      <PageTitle className="mb-6">Standard Sheet</PageTitle>
      {children}
    </div>
  );
}
