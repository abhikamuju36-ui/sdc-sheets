"use client";

import { useRouter } from "next/navigation";

// Month picker shared by the Monthly ETC and Standard Sheet pages — a
// dropdown instead of pills because the list grows by one every month
// forever. Navigates on change; the current (not-yet-started) month is
// offered as the first option when it has no entries yet so a new month can
// always be selected.
export function MonthSelect({
  months,
  current,
  basePath = "/etc",
  lockedMonths = [],
  inProgressSuffix = " — in progress",
  nextStartable,
}: {
  months: string[];
  current: string;
  // Query param target — "/etc" or "/standard-sheet".
  basePath?: string;
  lockedMonths?: string[];
  // Suffix for a month that has entries but isn't locked yet — pass "" to
  // omit it (Standard Sheet doesn't need an "in progress" label).
  inProgressSuffix?: string;
  // Offered as a "(new)" option once the latest month is locked — otherwise
  // there would be no way to navigate to the next month to start it.
  nextStartable?: string;
}) {
  const router = useRouter();
  const locked = new Set(lockedMonths);
  let options = months;
  if (nextStartable && !options.includes(nextStartable)) options = [nextStartable, ...options];
  if (!options.includes(current)) options = [current, ...options];

  return (
    <select
      value={current}
      onChange={(e) => router.push(`${basePath}?month=${e.target.value}`, { scroll: false })}
      className="rounded-lg border border-sdc-border bg-white px-3 py-1.5 text-sm font-medium text-sdc-navy shadow-sm outline-none focus:border-sdc-blue"
      aria-label="Month"
    >
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
          {!months.includes(m) ? " (new)" : locked.has(m) ? " — locked" : inProgressSuffix}
        </option>
      ))}
    </select>
  );
}
