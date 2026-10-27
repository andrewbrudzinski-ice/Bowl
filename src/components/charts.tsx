"use client";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Series {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

/**
 * Line chart with an equivalent data table underneath (collapsed) so the numbers are available to screen readers
 * and anyone who prefers a table. `reversed` flips the Y axis for ranks (1 at top).
 */
export function Trend({
  data, series, xKey = "week", xLabel = "Week", height = 220, reversed = false, yDomain, summary, refLine, integerY = false,
}: {
  data: Record<string, number | string | null>[];
  series: Series[];
  xKey?: string;
  xLabel?: string;
  height?: number;
  reversed?: boolean;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  summary: string;
  refLine?: { y: number; label: string };
  integerY?: boolean;
}) {
  if (!data.length) return null;
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#232b38" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fill: "#8f9aae", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#232b38" }} />
            <YAxis reversed={reversed} domain={yDomain ?? ["auto", "auto"]} allowDecimals={!integerY} tick={{ fill: "#8f9aae", fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={{ background: "#161b24", border: "1px solid #2f3949", borderRadius: 8, fontSize: 12 }} labelFormatter={(v) => `${xLabel} ${v}`} />
            {refLine ? <ReferenceLine y={refLine.y} stroke="#66718a" strokeDasharray="4 4" label={{ value: refLine.label, fill: "#8f9aae", fontSize: 10, position: "insideTopRight" }} /> : null}
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            ))}
            {series.length > 1 && series.length <= 8 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-1 text-xs">
        <summary className="muted inline-block cursor-pointer rounded px-1 hover:text-fg">View as table</summary>
        <div className="tbl-wrap mt-1 max-h-60 overflow-y-auto">
          <table className="tbl">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr>
                <th scope="col">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <th scope="row" className="l !text-left text-fg">{String(row[xKey])}</th>
                  {series.map((s) => (
                    <td key={s.key}>{row[s.key] ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
