"use client";

import { useRouter } from "next/navigation";

// Month picker for the Monthly ETC page — a dropdown instead of pills because
// the list grows by one every month forever. Navigates on change; the current
// (not-yet-started) month is offered as the first option when it has no
// entries yet so a new month can always be selected.
export function MonthSelect({
  months,
  current,
  lockedMonths,
  nextStartable,
}: {
  months: string[];
  current: string;
  lockedMonths: string[];
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
      onChange={(e) => router.push(`/etc?month=${e.target.value}`, { scroll: false })}
      className="rounded-lg border border-sdc-border bg-white px-3 py-1.5 text-sm font-medium text-sdc-navy shadow-sm outline-none focus:border-sdc-blue"
      aria-label="ETC month"
    >
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
          {!months.includes(m) ? " (new)" : locked.has(m) ? " — locked" : " — in progress"}
        </option>
      ))}
    </select>
  );
}
