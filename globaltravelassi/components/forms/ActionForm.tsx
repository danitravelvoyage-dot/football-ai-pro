"use client";

import { createContext, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
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
/**
 * Next's redirect() and notFound() inside an action are signals, not failures. They must reach the framework.
 * Their error digest starts with NEXT_ (for example NEXT_REDIRECT).
 */
function isFrameworkSignal(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error && typeof (error as { digest: unknown }).digest === "string" && (error as { digest: string }).digest.startsWith("NEXT_");
}

export function ActionForm({ action, messages, submitLabel, pendingLabel, children, className, resetOnSuccess, confirmMessage, hideSubmit, submitVariant = "gold" }: Props) {
  const [state, setState] = useState<ActionState | null>(null);
  // The pending flag is plain state, not a React transition. A transition also waits for the page refresh that
  // revalidatePath triggers, and that refresh could stall and keep the button disabled after a successful save.
  const [pending, setPending] = useState(false);
  // A ref, not state, so a second click in the same tick is refused before React re-renders.
  const inFlight = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    inFlight.current = true;
    setPending(true);
    try {
      const result = await action(data);
      if (result) {
        setState(result);
        if (result.ok && resetOnSuccess) form.reset();
      }
    } catch (error) {
      // The router performs the redirect. Stop waiting quietly; do not report an error.
      if (isFrameworkSignal(error)) return;
      setState({ ok: false, code: "generic" });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
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
