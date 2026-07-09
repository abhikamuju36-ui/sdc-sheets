"use client";

import { useEffect } from "react";

// Excel-style cell editing: focusing a numeric grid cell selects its whole
// value, so typing replaces it (like Excel) instead of appending. One
// document-level listener covers every grid input, including server-rendered
// ones that have no client handlers of their own.
export default function ExcelCellFocus() {
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === "number" && el.closest("td")) {
        el.select();
      }
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  return null;
}
