"use client";
// Recharts wrappers. Charts are always rendered LTR (numeric axes) even in the Arabic RTL layout.
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, ReferenceLine,
} from "recharts";
import { useI18n } from "./I18nProvider";

const AXIS = { stroke: "#8796b8", fontSize: 11 };
const GRID = "#1c2c4d";
const tooltipStyle = { background: "#0b1529", border: "1px solid #1c2c4d", borderRadius: 8, fontSize: 12, color: "#e2e8f0" };

export function GoalsTrendChart({ data }: { data: { label: string; for: number; against: number; xg?: number | null }[] }) {
  const { t } = useI18n();
  return (
    <div dir="ltr" className="h-56 w-full" role="img" aria-label={t("teams.goalsTrend")}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={AXIS} stroke={GRID} />
          <YAxis allowDecimals={false} tick={AXIS} stroke={GRID} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="for" name={t("stat.scored")} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="against" name={t("stat.conceded")} stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
          {data.some((d) => d.xg !== null && d.xg !== undefined) && (
            <Line type="monotone" dataKey="xg" name="xG" stroke="#f5b83d" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompareBarChart({ data, homeLabel, awayLabel }: { data: { metric: string; home: number; away: number }[]; homeLabel: string; awayLabel: string }) {
  return (
    <div dir="ltr" className="h-64 w-full" role="img" aria-label={`${homeLabel} / ${awayLabel}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="metric" tick={AXIS} stroke={GRID} interval={0} />
          <YAxis tick={AXIS} stroke={GRID} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(28,44,77,.35)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="home" name={homeLabel} fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="away" name={awayLabel} fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  const colors = ["#10b981", "#34d399", "#60a5fa", "#3b82f6", "#f5b83d", "#e09b12", "#f43f5e"];
  return (
    <div dir="ltr" className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} stroke={GRID} />
          <YAxis tick={AXIS} stroke={GRID} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(28,44,77,.35)" }} />
          <Bar dataKey="value" name={label} radius={[4, 4, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CalibrationChart({ data }: { data: { bucket: string; predicted: number; observed: number; n: number }[] }) {
  const { t } = useI18n();
  const d = data.map((x) => ({ ...x, predicted: +(x.predicted * 100).toFixed(1), observed: +(x.observed * 100).toFixed(1) }));
  return (
    <div dir="ltr" className="h-56 w-full" role="img" aria-label={t("leagues.calibration")}>
      <ResponsiveContainer>
        <BarChart data={d} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" tick={AXIS} stroke={GRID} />
          <YAxis tick={AXIS} stroke={GRID} unit="%" domain={[0, 100]} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(28,44,77,.35)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="predicted" name={t("leagues.predicted")} fill="#3b82f6" radius={[3, 3, 0, 0]} />
          <Bar dataKey="observed" name={t("leagues.observed")} fill="#10b981" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EvChart({ data }: { data: { name: string; ev: number }[] }) {
  return (
    <div dir="ltr" className="h-56 w-full" role="img" aria-label="EV">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={AXIS} stroke={GRID} unit="%" />
          <YAxis type="category" dataKey="name" tick={AXIS} stroke={GRID} width={110} />
          <ReferenceLine x={0} stroke="#8796b8" />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(28,44,77,.35)" }} />
          <Bar dataKey="ev" name="EV %" radius={3}>
            {data.map((d, i) => <Cell key={i} fill={d.ev > 0 ? "#10b981" : "#f43f5e"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
