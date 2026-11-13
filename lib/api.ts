import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function badRequest(err: ZodError | string) {
  return NextResponse.json(
    { error: "Invalid input", code: "INVALID_INPUT", details: typeof err === "string" ? err : err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    { status: 400 },
  );
}

export function serverError(e: unknown) {
  console.error("[api]", e);
  return NextResponse.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
}
