// One badge component for every colored pill in the app — job status, ETC
// review/confirm state, and generic neutral tags (source, type) all pick a
// variant instead of each page hand-rolling its own conditional classes.
const VARIANT_CLASSES = {
  active: "bg-sdc-blue-light text-sdc-blue-dark",
  complete: "bg-sdc-green-bg text-sdc-green-text",
  needsReview: "bg-sdc-yellow-bg text-sdc-yellow-text",
  confirmed: "bg-sdc-green-bg text-sdc-green-text",
  locked: "bg-sdc-gray-100 text-sdc-gray-700",
  notStarted: "bg-sdc-gray-100 text-sdc-gray-600",
  neutral: "bg-sdc-gray-100 text-sdc-gray-600",
} as const;

export type StatusVariant = keyof typeof VARIANT_CLASSES;

export function StatusBadge({
  variant,
  children,
}: {
  variant: StatusVariant;
  children: React.ReactNode;
}) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}>
      {children}
    </span>
  );
}
