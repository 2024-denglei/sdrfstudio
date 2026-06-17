import clsx from "clsx";
import type { ReactNode } from "react";

export function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("panel", className)}>
      {title && <h2 className="panel-title">{title}</h2>}
      {children}
    </section>
  );
}

export function Metric({ label, value, tone = "blue", sub }: { label: string; value: string | number; tone?: "blue" | "green" | "orange" | "red" | "purple"; sub?: string }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}
