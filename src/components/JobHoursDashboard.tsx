"use client";

import { useMemo, useState } from "react";
import { card } from "@/components/ui/classnames";
import { EChart } from "@/components/charts/EChart";
import { groupedBarOption } from "@/components/charts/theme";
import type { JobHoursDashboard as DashData, HoursType } from "@/lib/job-hours-dashboard";

// Web recreation of the Power BI "Job Detail" dashboard (hours half). The Hours
// Type toggle (Quoted / ETC) swaps the planned-basis series across the matrix
// and both charts, mirroring the report's field-parameter slicer.

// The fixed section template the chart/matrix always show (even at zero hours),
// matching the Power BI report: Complete Design & Build (excluding PM) +
// Machine Testing, in canonical order.
const TEMPLATE_PHASES = ["Complete Design & Build", "Machine Testing"];

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
        <div className={card("p-4")}>
          <p className="mb-1 font-heading text-base font-bold tracking-tight text-sdc-navy">Estimate to Complete vs Actual</p>
          <EChart
            height={400}
            option={groupedBarOption({
              categories: hierRows.map((r) => r.name),
              planned: hierRows.map((r) => r.planned),
              actual: hierRows.map((r) => r.actual),
              plannedLabel,
              sub: hierRows.map((r) => `${r.phase} · ${r.group}`),
              rotate: 40,
            })}
          />
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
