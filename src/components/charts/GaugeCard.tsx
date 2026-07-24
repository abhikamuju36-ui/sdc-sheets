"use client";

import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/EChart";
import { card } from "@/components/ui/classnames";

const NAVY = "#12239e";
const BLUE = "#118dff";
const RED = "#dc2626";
const GREEN = "#15803d";
const TRACK = "#eef1f5";
const MUTED = "#64748b";

function usd(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Angular gauge (Power BI–style) — value against a budget/target, with a needle,
// a colored progress arc (green under target, red over), and a % readout in the
// center. Built with ECharts so it renders reliably under the PM2 service (the
// data comes from Total ETO, not the Power BI token path).
export function GaugeCard({
  title,
  value,
  target,
  subLabel,
}: {
  title: string;
  value: number;
  target: number;
  subLabel?: string;
}) {
  const max = Math.max(target, value) || 1;
  const pct = target > 0 ? Math.round((value / target) * 100) : 0;
  const over = value > target;
  const arc = over ? RED : value >= target * 0.9 ? BLUE : GREEN;

  const option: EChartsOption = {
    series: [
      {
        type: "gauge",
        min: 0,
        max,
        startAngle: 210,
        endAngle: -30,
        radius: "92%",
        center: ["50%", "58%"],
        progress: { show: true, width: 16, roundCap: true, itemStyle: { color: arc } },
        axisLine: { lineStyle: { width: 16, color: [[1, TRACK]] } },
        pointer: { show: true, length: "58%", width: 5, itemStyle: { color: NAVY } },
        anchor: { show: true, size: 12, showAbove: true, itemStyle: { color: NAVY } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: false,
          offsetCenter: [0, "34%"],
          fontSize: 24,
          fontWeight: "bold",
          color: NAVY,
          formatter: () => `${pct}%`,
        },
        data: [{ value }],
      },
    ],
  };

  return (
    <div className={card("p-4")}>
      <p className="mb-1 font-heading text-base font-bold tracking-tight text-sdc-navy">{title}</p>
      <EChart height={200} option={option} />
      <div className="-mt-2 text-center">
        <p className="text-lg font-bold tabular-nums text-sdc-navy">{usd(value)}</p>
        <p className="text-xs" style={{ color: MUTED }}>
          of {usd(target)} {subLabel ?? "budget"}
          {over && <span className="ml-1 font-semibold" style={{ color: RED }}>· over</span>}
        </p>
      </div>
    </div>
  );
}
