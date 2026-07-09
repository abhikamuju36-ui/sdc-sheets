"use client";

import { useRouter } from "next/navigation";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Month + Year picker for the Monthly ETC page. Only months that exist (or
// the next startable month) are selectable — months must still be started in
// order so the Prior ETC carry-forward stays intact; everything else is
// disabled rather than hidden so the full year is visible.
export function MonthYearSelect({
  months,
  current,
  basePath = "/etc",
  lockedMonths = [],
  nextStartable,
}: {
  months: string[];
  current: string; // "YYYY-MM"
  basePath?: string;
  lockedMonths?: string[];
  // Offered once the latest month is locked — otherwise there would be no
  // way to navigate to the next month to start it.
  nextStartable?: string;
}) {
  const router = useRouter();
  const locked = new Set(lockedMonths);

  let selectable = months;
  if (nextStartable && !selectable.includes(nextStartable)) selectable = [nextStartable, ...selectable];
  if (!selectable.includes(current)) selectable = [current, ...selectable];
  const allowed = new Set(selectable);

  const [currentYear, currentMonth] = current.split("-");
  const years = Array.from(new Set(selectable.map((m) => m.slice(0, 4)))).sort().reverse();

  const go = (ym: string) => router.push(`${basePath}?month=${ym}`, { scroll: false });

  // Switching years jumps to that year's latest selectable month.
  const onYearChange = (year: string) => {
    if (year === currentYear) return;
    const inYear = selectable.filter((m) => m.startsWith(`${year}-`)).sort().reverse();
    if (inYear[0]) go(inYear[0]);
  };

  const statusSuffix = (ym: string) =>
    !months.includes(ym) ? " (new)" : locked.has(ym) ? " — locked" : " — in progress";

  const selectClass =
    "rounded-lg border border-sdc-border bg-white px-3 py-1.5 text-sm font-medium text-sdc-navy shadow-sm outline-none focus:border-sdc-blue";

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={currentMonth}
        onChange={(e) => go(`${currentYear}-${e.target.value}`)}
        className={selectClass}
        aria-label="Month"
      >
        {MONTH_NAMES.map((name, i) => {
          const mm = String(i + 1).padStart(2, "0");
          const ym = `${currentYear}-${mm}`;
          return (
            <option key={mm} value={mm} disabled={!allowed.has(ym)}>
              {name}
              {allowed.has(ym) ? statusSuffix(ym) : ""}
            </option>
          );
        })}
      </select>
      <select
        value={currentYear}
        onChange={(e) => onYearChange(e.target.value)}
        className={selectClass}
        aria-label="Year"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </span>
  );
}
