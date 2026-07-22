"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveAllNewEtcDrafts } from "@/lib/etc-actions";
import { isEtcDirty, clearEtcDirty } from "@/lib/etc-dirty-tracker";

// Batch-saves every currently-typed New ETC override across the grid in one
// click — nothing in EtcSectionCells autosaves on its own (see its comment),
// so this is the only thing that persists a manager's typed values. The
// whole grid already lives in one <form> (formId), so this just reads its
// current values via FormData rather than tracking them itself.
//
// Password-gated the first time each session — a popover like
// SubmitAndLockButton's; `unlocked` (from isEtcEditUnlocked() server-side)
// decides whether Save needs the popover at all this time. A beforeunload
// listener warns (native browser dialog, same as Word/Excel) if anything's
// been typed since the last successful Save.
export function SaveEtcDraftsButton({
  formId,
  month,
  unlocked,
  wrongPassword,
  className,
}: {
  formId: string;
  month: string;
  unlocked: boolean;
  wrongPassword: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Warn on a real browser-level unload (tab close, refresh, typed URL) if
  // anything typed hasn't gone through Save yet — same "leave without
  // saving?" prompt as Word/Excel. Client-side app navigation (e.g. the
  // month picker) doesn't fire this — only actual document unloads do.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isEtcDirty()) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function run(passwordAttempt?: string) {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    const fd = new FormData(form);
    if (passwordAttempt != null) fd.set("newEtcSavePassword", passwordAttempt);
    startTransition(async () => {
      const result = await saveAllNewEtcDrafts(month, fd);
      if (result.ok) {
        clearEtcDirty();
        setOpen(false);
        setPassword("");
      }
      // Wrong password: leave the popover open so "Wrong password" (from the
      // refreshed wrongPassword prop) is visible, and don't touch dirty —
      // nothing was actually saved.
    });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (unlocked) {
            run();
          } else {
            setPassword("");
            setOpen((v) => !v);
          }
        }}
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-sdc-border bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-semibold text-sdc-navy">Enter password to Save</p>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run(password);
            }}
            placeholder="Password"
            aria-label="Save password"
            className="w-full rounded-md border border-sdc-border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue"
          />
          {wrongPassword && <p className="mt-2 text-xs text-red-600">Wrong password</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="rounded-md px-3 py-1.5 text-sm text-sdc-gray-600 hover:bg-sdc-gray-100" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => run(password)}
              disabled={password.length === 0 || pending}
              className="rounded-md bg-sdc-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-sdc-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
