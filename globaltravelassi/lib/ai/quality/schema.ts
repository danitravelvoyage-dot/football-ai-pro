import type { z } from "zod";
import { issue } from "./checks";
import type { QualityIssue } from "./types";

/** Checks an output against its agreed contract. Any failure is a schema_failure, which rejects the output. */
export function schemaChecks(schema: z.ZodTypeAny, output: unknown): QualityIssue[] {
  const parsed = schema.safeParse(output);
  if (parsed.success) return [];
  const first = parsed.error.issues[0];
  const path = first?.path.length ? first.path.join(".") : "output";
  const code = first?.code === "invalid_type" && first.received === "undefined" ? "missing_required_field" : "schema_failure";
  return [issue(code, "schema_validity", "critical", path)];
}
