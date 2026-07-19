"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// Server actions give no built-in "it finished" signal — useFormStatus's
// `pending` flips back to false once the action resolves and the page
// revalidates, so a true->false transition is our completion event. Must be
// rendered as a child of the <form action={...}> it's reporting on.
export function RunReportButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), 4000);
      return () => clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <>
      <button type="submit" className={className} disabled={pending}>
        {pending ? "Refreshing…" : children}
      </button>
      {showToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-sdc-navy px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <span className="text-sdc-lime">✓</span> Report completed — data refreshed from the source systems.
        </div>
      )}
    </>
  );
}
