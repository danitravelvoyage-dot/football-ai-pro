"use client";

import { createContext, useContext, useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions/types";
import { Alert } from "@/components/ui";

type Messages = Record<string, string>;
type FormCtx = { errors: Record<string, string>; messages: Messages };
const FormContext = createContext<FormCtx>({ errors: {}, messages: {} });

export function useFormErrors(name: string): { error?: string; message: (code: string) => string } {
  const ctx = useContext(FormContext);
  const code = ctx.errors[name];
  return { error: code ? ctx.messages[code] ?? ctx.messages.invalid_input : undefined, message: (c) => ctx.messages[c] ?? c };
}

type Props = {
  /** Server action. Receives the form's data and returns an ActionState (or redirects). */
  action: (formData: FormData) => Promise<ActionState | void>;
  messages: Messages;
  submitLabel: string;
  pendingLabel: string;
  children: ReactNode;
  className?: string;
  /** Clear the inputs after a successful save. */
  resetOnSuccess?: boolean;
  /** Ask the user to confirm before submitting (for destructive actions). */
  confirmMessage?: string;
  /** Hide the built-in submit button (use a custom one inside children). */
  hideSubmit?: boolean;
  submitVariant?: "gold" | "navy";
};

/**
 * Submits to a server action without losing what the visitor typed when validation fails.
 * Shows field-level and form-level messages translated into the visitor's language.
 */
export function ActionForm({ action, messages, submitLabel, pendingLabel, children, className, resetOnSuccess, confirmMessage, hideSubmit, submitVariant = "gold" }: Props) {
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await action(data);
      if (result) {
        setState(result);
        if (result.ok && resetOnSuccess) form.reset();
      }
    });
  }

  const message = state && state.code ? messages[state.code] ?? messages.generic : null;

  return (
    <FormContext.Provider value={{ errors: state?.fieldErrors ?? {}, messages }}>
      <form onSubmit={onSubmit} className={className} noValidate aria-busy={pending}>
        {state && message && <Alert tone={state.ok ? "success" : "error"}>{message}</Alert>}
        {children}
        {!hideSubmit && (
          <button
            type="submit"
            disabled={pending}
            className={`inline-flex min-h-12 w-full items-center justify-center rounded-full px-6 py-3 text-base font-semibold transition duration-300 disabled:opacity-60 sm:w-auto ${
              submitVariant === "gold"
                ? "bg-gradient-to-b from-gold-400 to-gold-500 text-navy-950 shadow-lg shadow-gold-500/20 hover:-translate-y-0.5"
                : "bg-navy-800 text-white hover:bg-navy-700"
            }`}
          >
            {pending ? pendingLabel : submitLabel}
          </button>
        )}
      </form>
    </FormContext.Provider>
  );
}
