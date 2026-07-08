// Shared class-string vocabulary — every page draws cards, buttons, inputs, and
// table headers from here instead of hand-rolling the same Tailwind strings.

export const CARD_BASE = "rounded-xl border border-sdc-border bg-white shadow-sm transition-shadow";

export function card(padding: string = "p-5"): string {
  return `${CARD_BASE} ${padding}`;
}

export const BUTTON_PRIMARY =
  "rounded-md bg-sdc-blue px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-sdc-blue-dark hover:shadow-md active:translate-y-px active:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

export const BUTTON_SECONDARY =
  "rounded-md border border-sdc-border bg-white px-4 py-2 text-sm font-medium text-sdc-navy shadow-sm transition-all hover:border-sdc-blue-100 hover:bg-sdc-blue-light hover:shadow-md active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";

export const INPUT =
  "rounded-md border border-sdc-border bg-white px-3 py-2 text-sm text-sdc-navy shadow-sm transition-shadow outline-none focus:border-sdc-blue focus:ring-2 focus:ring-sdc-blue/15";

export const LABEL = "text-xs font-medium text-sdc-gray-700";

// Bottom-border only, no flat gray fill band — reads closer to a considered
// spreadsheet/ledger header than a generic admin-template table.
export const TABLE_HEADER_ROW =
  "border-b-2 border-sdc-border text-left text-[11px] font-semibold uppercase tracking-wider text-sdc-gray-600";

export const TABLE_ROW_HOVER = "transition-colors hover:bg-sdc-blue-light/40";
