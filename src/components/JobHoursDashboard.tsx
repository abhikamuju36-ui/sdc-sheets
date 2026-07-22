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

const fmt = (n: number) => Math.round(n).toLocaleString();

export function JobHoursDashboard({ data }: { data: DashData }) {
  const [hoursType, setHoursType] = useState<HoursType>("Quoted");
  const planned = (s: { quoted: number; etc: number }) => (hoursType === "Quoted" ? s.quoted : s.etc);
  const plannedLabel = hoursType === "Quoted" ? "Quoted" : "ETC";

  // Phase filter (simplified "Function Hierarchy" slicer). Default: phases that
  // actually carry data, which matches the report's populated columns.
  const phasesWithData = useMemo(() => {
    const set = new Set<string>();
    for (const s of data.sections) if (s.quoted || s.etc || s.actual) set.add(s.phase);
    return [...set];
  }, [data.sections]);
  const [activePhases, setActivePhases] = useState<Set<string>>(() => new Set(phasesWithData));

  const visible = useMemo(
    () => data.sections.filter((s) => activePhases.has(s.phase) && (s.quoted || s.etc || s.actual)),
    [data.sections, activePhases],
  );

  const sectionChart = visible.map((s) => ({ name: s.name, planned: planned(s), actual: s.actual }));
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
          {phasesWithData.map((p) => (
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
      {/* Per-section matrix: sections as columns, Quoted/Act/Diff each */}
      <div className={`${card("p-0")} overflow-x-auto`}>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-sdc-navy text-white">
              <th className="sticky left-0 z-10 bg-sdc-navy px-2 py-1.5 text-left">Section</th>
              {visible.map((s) => (
                <th key={s.code} colSpan={3} className="border-l border-white/20 px-2 py-1.5 text-center">
                  {s.name}
                </th>
              ))}
            </tr>
            <tr className="bg-sdc-gray-100 text-sdc-gray-600">
              <th className="sticky left-0 z-10 bg-sdc-gray-100 px-2 py-1 text-left">{data.job.jobId}</th>
              {visible.map((s) => (
                <>
                  <th key={`${s.code}-q`} className="border-l border-sdc-border-soft px-2 py-1 text-right font-medium">{plannedLabel}</th>
                  <th key={`${s.code}-a`} className="px-2 py-1 text-right font-medium">Act</th>
                  <th key={`${s.code}-d`} className="px-2 py-1 text-right font-medium">Diff</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="tabular-nums">
              <td className="sticky left-0 z-10 bg-white px-2 py-1.5 font-medium text-sdc-navy">Hours</td>
              {visible.map((s) => {
                const p = planned(s);
                const diff = p - s.actual;
                return (
                  <>
                    <td key={`${s.code}-qv`} className="border-l border-sdc-border-soft px-2 py-1.5 text-right text-sdc-blue-dark">{fmt(p)}</td>
                    <td key={`${s.code}-av`} className="bg-sdc-blue-light/50 px-2 py-1.5 text-right font-semibold">{fmt(s.actual)}</td>
                    <td key={`${s.code}-dv`} className={`px-2 py-1.5 text-right ${diff < 0 ? "text-red-600" : "text-sdc-gray-500"}`}>{fmt(diff)}</td>
                  </>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <div className={card("p-4")}>
          <p className="mb-3 font-heading text-base font-bold tracking-tight text-sdc-navy">Estimate to Complete vs Actual</p>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={sectionChart} margin={{ top: 16, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="planned" name={plannedLabel} fill={BLUE} />
              <Bar dataKey="actual" name="Actual" fill={NAVY} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={card("p-4")}>
          <p className="mb-3 font-heading text-base font-bold tracking-tight text-sdc-navy">{plannedLabel} and Actual by Billing Group</p>
          <ResponsiveContainer width="100%" height={340}>
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
