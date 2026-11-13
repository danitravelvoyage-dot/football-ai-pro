"use client";
import clsx from "clsx";
import { useEffect, useId, useState } from "react";

export function Tabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (tabs.some((t) => t.id === h)) setActive(h);
  }, [tabs]);
  const select = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };
  return (
    <div>
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-ink-900/70 p-1">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const rtl = document.documentElement.dir === "rtl";
              const dir = (e.key === "ArrowRight") !== rtl ? 1 : -1;
              const next = tabs[(i + dir + tabs.length) % tabs.length];
              select(next.id);
              document.getElementById(`${base}-tab-${next.id}`)?.focus();
            }}
            className={clsx("whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
              active === t.id ? "bg-emerald-500/15 text-emerald-300" : "text-slate-400 hover:text-slate-100")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
