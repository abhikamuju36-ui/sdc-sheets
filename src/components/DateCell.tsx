"use client";

import { useState } from "react";

// Native <input type="date"> shows literal "mm/dd/yyyy" segments when empty,
// which reads as noisy placeholder clutter across a whole column of blank
// dates. Hiding those segments (via the .date-empty rule in globals.css)
// leaves just the calendar icon until a real date is picked — tracked with
// local state (not a CSS-only trick) so a freshly-picked date shows immediately
// without waiting for the page to re-render from the server.
export function DateCell({
  name,
  defaultValue,
  ariaLabel,
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
}) {
  const [empty, setEmpty] = useState(defaultValue === "");
  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      className={empty ? "date-empty" : undefined}
      onChange={(e) => setEmpty(e.target.value === "")}
    />
  );
}
