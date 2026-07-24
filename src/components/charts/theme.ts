import type { EChartsOption } from "echarts";

// SDC chart design tokens. Categorical pair validated (dataviz skill):
// blue #118dff ↔ amber #f59e0b — CVD ΔE 31.6 (strong). Both series always carry
// direct value labels, which satisfies amber's low surface-contrast (secondary
// encoding). Text always uses ink tokens, never the series color.
export const SERIES = {
  planned: "#408bf7", // Quoted / ETC (planned basis)
  actual: "#162398", // Actual
} as const;

const INK = "#12239e"; // sdc-navy — headings/values
const MUTED = "#64748b"; // axis / secondary
const GRID = "#eef1f5"; // recessive gridlines
const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";

export function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
export function compact(n: number): string {
  return Math.round(n).toLocaleString();
}

// A polished grouped-bar chart: two series (planned vs actual) over a set of
// categories, with a recessive axis/grid, rounded thin bars, a rich shared
// tooltip, and selective direct labels. `rows` supply the category + values;
// `sub` is optional secondary text (e.g. "Phase · Dept") shown in the tooltip.
export function groupedBarOption(opts: {
  categories: string[];
  planned: number[];
  actual: number[];
  plannedLabel: string;
  sub?: string[];
  valueFormatter?: (n: number) => string;
  rotate?: number;
}): EChartsOption {
  const fmt = opts.valueFormatter ?? compact;
  return {
    color: [SERIES.planned, SERIES.actual],
    textStyle: { fontFamily: FONT },
    grid: { top: 40, left: 8, right: 12, bottom: opts.rotate ? 64 : 28, containLabel: true },
    legend: {
      top: 6,
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 18,
      icon: "roundRect",
      textStyle: { color: MUTED, fontSize: 12 },
      data: [opts.plannedLabel, "Actual"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(17,141,255,0.06)" } },
      backgroundColor: "#ffffff",
      borderColor: GRID,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: "#0f172a", fontSize: 12 },
      extraCssText: "box-shadow:0 8px 24px rgba(6,29,57,0.12); border-radius:10px;",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number; seriesName: string; value: number; marker: string }[];
        const i = arr[0]?.dataIndex ?? 0;
        const head = `<div style="font-weight:600;color:${INK};margin-bottom:2px">${opts.categories[i]}</div>`;
        const subLine = opts.sub?.[i] ? `<div style="color:${MUTED};font-size:11px;margin-bottom:6px">${opts.sub[i]}</div>` : "";
        const lines = arr
          .map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><b style="color:${INK}">${fmt(Number(p.value) || 0)}</b></div>`)
          .join("");
        return head + subLine + lines;
      },
    },
    xAxis: {
      type: "category",
      data: opts.categories,
      axisLine: { lineStyle: { color: GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: MUTED,
        fontSize: 11,
        rotate: opts.rotate ?? 0,
        interval: 0,
        hideOverlap: true,
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: GRID } },
      axisLabel: { color: MUTED, fontSize: 11, formatter: (v: number) => fmt(v) },
    },
    series: [
      {
        name: opts.plannedLabel,
        type: "bar",
        data: opts.planned,
        barMaxWidth: 26,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: MUTED, fontSize: 10, formatter: (p: unknown) => { const v = Number((p as { value?: number }).value) || 0; return v ? fmt(v) : ""; } },
      },
      {
        name: "Actual",
        type: "bar",
        data: opts.actual,
        barMaxWidth: 26,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: MUTED, fontSize: 10, formatter: (p: unknown) => { const v = Number((p as { value?: number }).value) || 0; return v ? fmt(v) : ""; } },
      },
    ],
  };
}
