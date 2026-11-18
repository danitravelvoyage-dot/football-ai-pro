/** Result returned by every server action. `code` is translated by the UI; never show raw errors. */
export type ActionState = {
  ok: boolean;
  code: string;
  fieldErrors?: Record<string, string>;
  id?: string;
  reference?: string;
};

export const initialActionState: ActionState = { ok: false, code: "" };
