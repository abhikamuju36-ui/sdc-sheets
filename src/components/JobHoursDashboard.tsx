"use client";

import { useMemo, useState } from "react";
import { card } from "@/components/ui/classnames";
import { EChart } from "@/components/charts/EChart";
import { groupedBarOption, SERIES } from "@/components/charts/theme";
import type { JobHoursDashboard as DashData, HoursType } from "@/lib/job-hours-dashboard";

// Web recreation of the Power BI "Job Detail" dashboard (hours half). The Hours
// Type toggle (Quoted / ETC) swaps the planned-basis series across the matrix
// and both charts, mirroring the report's field-parameter slicer.

// The fixed section template the chart/matrix always show (even at zero hours),
// matching the Power BI report: Complete Design & Build (excluding PM) +
// Machine Testing, in canonical order.
const TEMPLATE_PHASES = ["Complete Design & Build", "Machine Testing"];

// Divider color for the tiered category axis — darker than the default border
// so the dashed group dividers read clearly.
const TIER_DIVIDER = "#94a3b8";

const fmt = (n: number) => Math.round(n).toLocaleString();

// Consecutive runs of a key, with counts — for the tiered dept/phase headers.
function groupRuns<T>(rows: T[], keyOf: (r: T) => string, labelOf: (r: T) => string) {
  const out: { label: string; count: number }[] = [];
  let lastKey: string | null = null;
  for (const r of rows) {
    const k = keyOf(r);
    if (k === lastKey) out[out.length - 1].count++;
    else { out.push({ label: labelOf(r), count: 1 }); lastKey = k; }
  }
  return out;
}

export function JobHoursDashboard({ data }: { data: DashData }) {
  const [hoursType, setHoursType] = useState<HoursType>("Quoted");
  const planned = (s: { quoted: number; etc: number }) => (hoursType === "Quoted" ? s.quoted : s.etc);
  const plannedLabel = hoursType === "Quoted" ? "Quoted" : "ETC";

  // Fixed template — always show these phases/sections, even at zero hours.
  const [activePhases, setActivePhases] = useState<Set<string>>(() => new Set(TEMPLATE_PHASES));

  const templateSections = useMemo(
    () => data.sections.filter((s) => TEMPLATE_PHASES.includes(s.phase) && s.code !== "10-111"),
    [data.sections],
  );
  const visible = useMemo(
    () => templateSections.filter((s) => activePhases.has(s.phase)),
    [templateSections, activePhases],
  );

  const hierRows = visible.map((s) => ({ code: s.code, name: s.name, group: s.group, phase: s.phase, planned: planned(s), actual: s.actual }));
  const bgChart = data.billingGroups
    .filter((g) => g.quoted || g.etc || g.actual)
    .map((g) => ({ name: g.group, planned: hoursType === "Quoted" ? g.quoted : g.etc, actual: g.actual }));

  const togglePhase = (p: string) =>
    setActivePhases((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Active Jobs" value={String(data.kpis.activeJobs)} />
        <Kpi label="Hours Refreshed Thru" value={data.kpis.hoursRefreshedThru ?? "—"} />
        <Kpi label="Latest ETC Month" value={data.kpis.latestEtcMonth ?? "—"} />
        <Kpi
          label="Eng Design-to-Debug Ratio"
          value={data.kpis.designToDebugRatio != null ? data.kpis.designToDebugRatio.toFixed(2) : "—"}
        />
      </div>

      {/* Controls: Hours Type + phase filter */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="inline-flex rounded-lg bg-sdc-gray-100 p-1">
          {(["Quoted", "ETC"] as HoursType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setHoursType(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                hoursType === t ? "bg-white text-sdc-blue-dark shadow-sm" : "text-sdc-gray-600 hover:text-sdc-navy"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_PHASES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePhase(p)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                activePhases.has(p)
                  ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
                  : "border-sdc-border-soft text-sdc-gray-500 hover:text-sdc-navy"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={card("p-8")}>
          <p className="text-center text-sdc-gray-500">No hours recorded for this job yet.</p>
        </div>
      ) : (
      <>
      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <div className={`${card("p-4")} overflow-x-auto`}>
          <p className="mb-3 font-heading text-base font-bold tracking-tight text-sdc-navy">Estimate to Complete vs Actual</p>
          <SectionHierarchyChart rows={hierRows} plannedLabel={plannedLabel} />
        </div>
        <div className={card("p-4")}>
          <p className="mb-1 font-heading text-base font-bold tracking-tight text-sdc-navy">{plannedLabel} and Actual by Billing Group</p>
          <EChart
            height={400}
            option={groupedBarOption({
              categories: bgChart.map((g) => g.name),
              planned: bgChart.map((g) => g.planned),
              actual: bgChart.map((g) => g.actual),
              plannedLabel,
              diffs: bgChart.map((g) => g.planned - g.actual),
            })}
          />
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={card("p-5")}>
      <p className="text-xs font-semibold text-sdc-gray-600">{label}</p>
      <p className="mt-3 font-heading text-[26px] font-bold tracking-tight text-sdc-navy">{value}</p>
    </div>
  );
}

type HierRow = { code: string; name: string; group: string; phase: string; planned: number; actual: number };

// Custom grouped-column chart with the Power BI tiered category axis:
// Section names → Department → Phase, with dashed dividers between groups. Shows
// every template section, even at zero. Grid columns = sections so the tiers
// line up by construction (no pixel math).
function SectionHierarchyChart({ rows, plannedLabel }: { rows: HierRow[]; plannedLabel: string }) {
  const BAR_H = 300;
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned, r.actual]));
  const deptRuns = groupRuns(rows, (r) => `${r.phase}|${r.group}`, (r) => r.group);
  const phaseRuns = groupRuns(rows, (r) => r.phase, (r) => r.phase);
  const colStyle = { gridTemplateColumns: `repeat(${rows.length}, minmax(60px, 1fr))` } as const;

  // Hovered section index + cursor position, for the floating tooltip.
  const [hover, setHover] = useState<{ row: HierRow; x: number; y: number } | null>(null);

  const Bar = ({ value, color }: { value: number; color: string }) => (
    <div className="flex h-full flex-col items-center justify-end">
      <span className="mb-0.5 text-[8px] leading-none text-sdc-gray-500">{value ? fmt(value) : ""}</span>
      <div className="w-5 rounded-t-sm" style={{ height: `${(value / max) * 100}%`, background: color }} />
    </div>
  );

  return (
    <div className="relative min-w-[640px]">
      <div className="mb-2 flex items-center gap-4 text-xs text-sdc-gray-600">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.planned }} /> {plannedLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.actual }} /> Actual</span>
      </div>
      {/* Bars — with the Quoted−Actual variance called out on top of each group
          (green when Actual is under Quoted, red when over). */}
      <div className="grid items-end gap-x-1" style={{ ...colStyle, height: BAR_H }}>
        {rows.map((r) => {
          const diff = r.planned - r.actual; // Quoted − Actual: + = under Quoted (green), − = over (red)
          const has = r.planned !== 0 || r.actual !== 0;
          return (
            <div
              key={r.code}
              className="flex h-full flex-col rounded-sm hover:bg-sdc-blue-light/30"
              onMouseMove={(e) => {
                const box = e.currentTarget.parentElement!.getBoundingClientRect();
                setHover({ row: r, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <div className={`h-4 text-center text-[11px] font-bold leading-none ${!has ? "text-transparent" : diff > 0 ? "text-sdc-green-text" : diff < 0 ? "text-red-600" : "text-sdc-gray-400"}`}>
                {has ? `${diff > 0 ? "+" : ""}${fmt(diff)}` : ""}
              </div>
              <div className="flex flex-1 items-end justify-center gap-1.5">
                <Bar value={r.planned} color={SERIES.planned} />
                <Bar value={r.actual} color={SERIES.actual} />
              </div>
            </div>
          );
        })}
      </div>
      {hover && (() => {
        const diff = hover.row.actual - hover.row.planned;
        return (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-sdc-border bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: hover.x, top: hover.y - 12 }}
          >
            <div className="mb-1 font-semibold text-sdc-navy">{hover.row.name}</div>
            <div className="text-[10px] text-sdc-gray-500">{hover.row.phase} · {hover.row.group}</div>
            <div className="mt-1 flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.planned }} /><span className="text-sdc-gray-600">{plannedLabel}:</span> <span className="font-medium tabular-nums">{fmt(hover.row.planned)}</span></div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.actual }} /><span className="text-sdc-gray-600">Actual:</span> <span className="font-medium tabular-nums">{fmt(hover.row.actual)}</span></div>
            <div className={`mt-0.5 font-semibold tabular-nums ${diff > 0 ? "text-red-600" : diff < 0 ? "text-sdc-green-text" : "text-sdc-gray-400"}`}>
              Diff: {diff > 0 ? "+" : ""}{fmt(diff)}
            </div>
          </div>
        );
      })()}
      {/* Tier 1 — section names (variance is shown on top of the bars above) */}
      <div className="grid gap-x-1 border-t pt-1" style={{ ...colStyle, borderTopColor: TIER_DIVIDER }}>
        {rows.map((r) => (
          <div key={r.code} className="px-0.5 text-center leading-tight">
            <div className="text-[10px] text-sdc-navy">{r.name}</div>
          </div>
        ))}
      </div>
      {/* Tier 2 — department, spanning its sections */}
      <div className="mt-1 grid" style={colStyle}>
        {deptRuns.map((g, i) => (
          <div key={i} style={{ gridColumn: `span ${g.count}`, borderLeftColor: TIER_DIVIDER }} className="border-l border-dashed py-0.5 text-center text-[10px] font-medium text-sdc-gray-600 first:border-l-0">
            {g.label}
          </div>
        ))}
      </div>
      {/* Tier 3 — phase, spanning its departments */}
      <div className="mt-0.5 grid" style={colStyle}>
        {phaseRuns.map((p, i) => (
          <div key={i} style={{ gridColumn: `span ${p.count}`, borderLeftColor: TIER_DIVIDER, borderTopColor: TIER_DIVIDER }} className="border-l border-t border-dashed py-1 text-center text-[11px] font-semibold text-sdc-navy first:border-l-0">
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
