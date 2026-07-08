"use client";

// Spreadsheet-style editing: clicking into the cell selects the whole value
// instead of just placing a caret, so typing replaces it outright.
export function SelectOnFocusInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} onFocus={(e) => e.currentTarget.select()} />;
}
