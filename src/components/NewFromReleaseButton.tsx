"use client";

import { useRef, useState, useTransition } from "react";
import { createJobFromRelease } from "@/lib/project-release-actions";

// "+ From Release" on the Projects tab: pick an SDC Project Release (.pdf/.docx)
// and it creates the job straight from the doc (Job number / title / buyer +
// order date), attaches the parsed release, and jumps to the new job page.
// Calls the server action directly (no nested <form>, since the Projects grid is
// already one big form).
export function NewFromReleaseButton({ className }: { className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        title="Create a job from an SDC Project Release (.pdf or .docx)"
      >
        {pending ? "Reading…" : "+ From Release"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file later
          if (!file) return;
          setError(null);
          const fd = new FormData();
          fd.append("file", file);
          startTransition(async () => {
            try {
              await createJobFromRelease(fd); // redirects to the new job on success
            } catch (err) {
              // A redirect throws a control-flow signal we must not treat as an error.
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes("NEXT_REDIRECT")) return;
              setError(msg);
            }
          });
        }}
      />
      {error && (
        <span className="absolute top-full mt-1 max-w-xs rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
          {error}
        </span>
      )}
    </span>
  );
}
