"use client";

// Tracks whether any New ETC cell has an unsaved edit since the last
// successful Save — a plain module-scope flag (not React state/context) so
// every independent EtcSectionCells instance and the Save button can share
// it without prop-drilling through the whole grid (same no-context spirit as
// ColumnResize.tsx). Backs the Save button's beforeunload "unsaved changes"
// warning — nothing else reads it.
let dirty = false;

export function markEtcDirty(): void {
  dirty = true;
}

export function clearEtcDirty(): void {
  dirty = false;
}

export function isEtcDirty(): boolean {
  return dirty;
}
