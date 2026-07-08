"use client";

export default function MonthlyEtcError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="w-full p-8">
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="mb-2 text-sm font-semibold text-red-800">Submission rejected</h2>
        <p className="mb-4 text-sm text-red-700">{error.message}</p>
        <p className="mb-4 text-xs text-red-600">
          Nothing was saved — fix the value above and submit again. Reloading is safe.
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Back to Monthly ETC
        </button>
      </div>
    </div>
  );
}
