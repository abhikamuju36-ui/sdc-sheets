"use client";

import { addNewProjectRow } from "@/components/NewProjectRowsStore";

// Was a <Link href="/quoted/new">; now drops a blank editable row straight
// into the table instead of navigating away — see NewProjectRowsStore.
export function AddProjectButton({ className }: { className: string }) {
  return (
    <button type="button" onClick={() => addNewProjectRow()} className={className}>
      + Add Project
    </button>
  );
}
