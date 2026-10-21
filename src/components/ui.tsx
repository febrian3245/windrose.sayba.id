"use client";

import type { ReactNode } from "react";

export function Panel({
  id,
  title,
  question,
  children,
  actions,
}: {
  id?: string;
  title: string;
  question?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-lg border border-line bg-panel">
      <header className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {question ? <p className="mt-0.5 text-sm text-muted">{question}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-10 rounded px-3 text-sm font-medium transition-colors ${
              active ? "bg-brand text-white" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-sm text-muted" title={label}>{label}</dt>
      <dd className="mt-1">
        <span className="tabular text-xl font-semibold text-ink sm:text-2xl">{value}</span>
        {unit ? <span className="ml-1 text-sm text-muted">{unit}</span> : null}
        {note ? <div className="mt-0.5 text-sm leading-snug">{note}</div> : null}
      </dd>
    </div>
  );
}
