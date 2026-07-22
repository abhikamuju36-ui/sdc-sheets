"use client";

import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Legend,
} from "recharts";
import { card } from "@/components/ui/classnames";
import type { JobHoursDashboard as DashData, HoursType } from "@/lib/job-hours-dashboard";

// Web recreation of the Power BI "Job Detail" dashboard (hours half). The Hours
// Type toggle (Quoted / ETC) swaps the planned-basis series across the matrix
// and both charts, mirroring the report's field-parameter slicer.
const BLUE = "#118dff"; // planned (Quoted/ETC) — PBI series color 1
const NAVY = "#12239e"; // actual — PBI series color 2

// The fixed section template the chart/matrix always show (even at zero hours),
// matching the Power BI report: Complete Design & Build (excluding PM) +
// Machine Testing, in canonical order.
const TEMPLATE_PHASES = ["Complete Design & Build", "Machine Testing"];

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

  const totalPlanned = visible.reduce((sum, x) => sum + planned(x), 0);
  const totalActual = visible.reduce((sum, x) => sum + x.actual, 0);
  const totalDiff = totalPlanned - totalActual;

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
      {/* Per-section matrix: sections as ROWS — never scrolls horizontally. */}
      <div className={`${card("p-0")} overflow-hidden`}>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="bg-sdc-navy text-left text-white">
              <th className="px-3 py-2 font-medium">Section</th>
              <th className="px-3 py-2 font-medium">Phase · Dept</th>
              <th className="px-3 py-2 text-right font-medium">{plannedLabel}</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Diff</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const p = planned(s);
              const diff = p - s.actual;
              return (
                <tr key={s.code} className="border-b border-sdc-border-soft/60 odd:bg-white even:bg-sdc-gray-50/60 hover:bg-sdc-blue-light/40">
                  <td className="px-3 py-1.5 font-medium text-sdc-navy">{s.name}</td>
                  <td className="px-3 py-1.5 text-xs text-sdc-gray-500">{s.phase} · {s.group}</td>
                  <td className="px-3 py-1.5 text-right text-sdc-blue-dark">{fmt(p)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold">{fmt(s.actual)}</td>
                  <td className={`px-3 py-1.5 text-right ${diff < 0 ? "text-red-600" : "text-sdc-gray-500"}`}>{fmt(diff)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-sdc-border bg-sdc-gray-100 font-bold text-sdc-navy">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right">{fmt(totalPlanned)}</td>
              <td className="px-3 py-2 text-right">{fmt(totalActual)}</td>
              <td className={`px-3 py-2 text-right ${totalDiff < 0 ? "text-red-600" : ""}`}>{fmt(totalDiff)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <div className={`${card("p-4")} overflow-x-auto`}>
          <p className="mb-3 font-heading text-base font-bold tracking-tight text-sdc-navy">Estimate to Complete vs Actual</p>
          <SectionHierarchyChart rows={hierRows} plannedLabel={plannedLabel} />
        </div>
        <div className={card("p-4")}>
          <p className="mb-3 font-heading text-base font-bold tracking-tight text-sdc-navy">{plannedLabel} and Actual by Billing Group</p>
          <ResponsiveContainer width="100%" height={440}>
            <BarChart data={bgChart} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="planned" name={plannedLabel} fill={BLUE}><LabelList dataKey="planned" position="top" fontSize={10} formatter={(v: unknown) => fmt(Number(v))} /></Bar>
              <Bar dataKey="actual" name="Actual" fill={NAVY}><LabelList dataKey="actual" position="top" fontSize={10} formatter={(v: unknown) => fmt(Number(v))} /></Bar>
            </BarChart>
          </ResponsiveContainer>
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

  const Bar = ({ value, color }: { value: number; color: string }) => (
    <div className="flex h-full flex-col items-center justify-end" title={fmt(value)}>
      <span className="mb-0.5 text-[8px] leading-none text-sdc-gray-500">{value ? fmt(value) : ""}</span>
      <div className="w-5 rounded-t-sm" style={{ height: `${(value / max) * 100}%`, background: color }} />
    </div>
  );

  return (
    <div className="min-w-[640px]">
      <div className="mb-2 flex items-center gap-4 text-xs text-sdc-gray-600">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BLUE }} /> {plannedLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NAVY }} /> Actual</span>
      </div>
      {/* Bars */}
      <div className="grid items-end gap-x-1" style={{ ...colStyle, height: BAR_H }}>
        {rows.map((r) => (
          <div key={r.code} className="flex h-full items-end justify-center gap-1.5">
            <Bar value={r.planned} color={BLUE} />
            <Bar value={r.actual} color={NAVY} />
          </div>
        ))}
      </div>
      {/* Tier 1 — section names */}
      <div className="grid gap-x-1 border-t border-sdc-border pt-1" style={colStyle}>
        {rows.map((r) => (
          <div key={r.code} className="px-0.5 text-center text-[10px] leading-tight text-sdc-navy">{r.name}</div>
        ))}
      </div>
      {/* Tier 2 — department, spanning its sections */}
      <div className="mt-1 grid" style={colStyle}>
        {deptRuns.map((g, i) => (
          <div key={i} style={{ gridColumn: `span ${g.count}` }} className="border-l border-dashed border-sdc-border py-0.5 text-center text-[10px] font-medium text-sdc-gray-600 first:border-l-0">
            {g.label}
          </div>
        ))}
      </div>
      {/* Tier 3 — phase, spanning its departments */}
      <div className="mt-0.5 grid" style={colStyle}>
        {phaseRuns.map((p, i) => (
          <div key={i} style={{ gridColumn: `span ${p.count}` }} className="border-l border-t border-dashed border-sdc-border py-1 text-center text-[11px] font-semibold text-sdc-navy first:border-l-0">
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
