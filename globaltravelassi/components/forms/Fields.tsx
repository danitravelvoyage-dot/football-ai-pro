"use client";

import type { ReactNode } from "react";
import { useFormErrors } from "./ActionForm";

const control =
  "mt-2 w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:ring-rose-200 disabled:bg-navy-50";

type Common = { name: string; label: string; hint?: string; required?: boolean; className?: string };

function Wrap({ name, label, hint, required, className, children }: Common & { children: (p: { id: string; describedBy: string }) => ReactNode; error?: string }) {
  const { error } = useFormErrors(name);
  const id = `f-${name}`;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className ?? "block"}>
      <label htmlFor={id} className="block text-sm font-semibold text-navy-800">
        {label}
        {required && !label.includes("*") && <span className="text-gold-600"> *</span>}
      </label>
      {children({ id, describedBy: describedBy ?? "" })}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-navy-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1.5 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField(props: Common & {
  type?: string; defaultValue?: string; autoComplete?: string; ltr?: boolean; placeholder?: string; maxLength?: number; min?: string; inputMode?: "text" | "tel" | "email" | "numeric" | "decimal";
}) {
  const { name, type = "text", defaultValue, autoComplete, ltr, placeholder, maxLength, min, inputMode, required } = props;
  const { error } = useFormErrors(name);
  return (
    <Wrap {...props}>
      {({ id, describedBy }) => (
        <input
          id={id}
          name={name}
          type={type}
          defaultValue={defaultValue}
          autoComplete={autoComplete}
          placeholder={placeholder}
          maxLength={maxLength}
          min={min}
          inputMode={inputMode}
          required={required}
          dir={ltr ? "ltr" : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className={`${control} ${ltr ? "text-left" : ""}`}
        />
      )}
    </Wrap>
  );
}

export function SelectField(props: Common & { options: { value: string; label: string }[]; defaultValue?: string; placeholder?: string }) {
  const { name, options, defaultValue, placeholder, required } = props;
  const { error } = useFormErrors(name);
  return (
    <Wrap {...props}>
      {({ id, describedBy }) => (
        <select
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className={control}
        >
          <option value="">{placeholder ?? ""}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Wrap>
  );
}

export function TextAreaField(props: Common & { defaultValue?: string; rows?: number; maxLength?: number; placeholder?: string }) {
  const { name, defaultValue, rows = 4, maxLength, placeholder, required } = props;
  const { error } = useFormErrors(name);
  return (
    <Wrap {...props}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          name={name}
          rows={rows}
          defaultValue={defaultValue}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className={control}
        />
      )}
    </Wrap>
  );
}

export function CheckboxField({ name, label, required, defaultChecked, className }: {
  name: string; label: ReactNode; required?: boolean; defaultChecked?: boolean; className?: string;
}) {
  const { error } = useFormErrors(name);
  const id = `f-${name}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-navy-800">
        <input
          id={id}
          name={name}
          type="checkbox"
          required={required}
          defaultChecked={defaultChecked}
          aria-invalid={Boolean(error)}
          className="mt-1 size-5 shrink-0 rounded border-navy-300 text-gold-500 focus:ring-gold-300"
        />
        <span>{label}</span>
      </label>
      {error && <p className="mt-1.5 text-sm font-medium text-rose-700">{error}</p>}
    </div>
  );
}
