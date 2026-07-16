// Shared class-string vocabulary — every page draws cards, buttons, inputs, and
// table headers from here instead of hand-rolling the same Tailwind strings.

export const CARD_BASE = "rounded-xl border border-sdc-border bg-white shadow-sm transition-shadow";

export function card(padding: string = "p-5"): string {
  return `${CARD_BASE} ${padding}`;
}

export const BUTTON_PRIMARY =
  "rounded-lg bg-sdc-blue px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(21,116,196,0.25),0_4px_10px_rgba(21,116,196,0.18)] transition-all hover:bg-sdc-blue-dark hover:shadow-[0_2px_4px_rgba(21,116,196,0.3),0_6px_14px_rgba(21,116,196,0.22)] active:translate-y-px active:shadow-[0_1px_2px_rgba(21,116,196,0.25)] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

export const BUTTON_SECONDARY =
  "rounded-lg border border-sdc-border bg-white px-5 py-2.5 text-sm font-semibold text-sdc-navy shadow-sm transition-all hover:border-sdc-blue-100 hover:bg-sdc-blue-light hover:shadow-md active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";

export const INPUT =
  "rounded-lg border border-sdc-border bg-white px-3.5 py-2.5 text-sm text-sdc-navy shadow-sm transition-shadow outline-none focus:border-sdc-blue focus:ring-2 focus:ring-sdc-blue/15";

export const LABEL = "text-[13px] font-semibold text-sdc-navy";

// Bottom-border only, no flat gray fill band — reads closer to a considered
// spreadsheet/ledger header than a generic admin-template table.
export const TABLE_HEADER_ROW =
  "border-b-2 border-sdc-border text-center text-[10px] font-semibold uppercase tracking-wider text-sdc-gray-600";

export const TABLE_ROW_HOVER = "transition-colors hover:bg-sdc-blue-light/40";

// Full gridlines + tabular-width numerals — makes data tables read like a
// spreadsheet grid (what finance/PM reviewers expect) instead of a generic
// borderless admin-table list.
// border-separate (not collapse) is load-bearing: collapsed borders belong to
// the shared grid edges on the scrolling layer, so sticky cells pin in place
// while their borders scroll away — ghost gridlines float over the frozen
// columns/headers. With separate borders each cell owns its bottom+left edge
// and they travel with the cell; border-spacing-0 keeps the grid seamless.
export const TABLE_GRID =
  "border-separate border-spacing-0 [&_th]:border-b [&_th]:border-l [&_th]:border-[#808080] [&_td]:border-b [&_td]:border-l [&_td]:border-[#808080] [&_td]:tabular-nums [&_td]:font-semibold";

// Table wrapper — sharp corners (not CARD_BASE's rounded-xl) so the grid's
// straight gridlines run flush to the container edge, like a real spreadsheet.
export const TABLE_CARD = "overflow-hidden border border-sdc-border bg-white shadow-sm";
