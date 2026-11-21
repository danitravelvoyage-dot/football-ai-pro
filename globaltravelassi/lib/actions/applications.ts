"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { applicationSchema } from "@/lib/validation/schemas";
import { formObject, localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";
import { customerSession } from "./customer-session";
import { queueCustomerEmail } from "@/lib/email/notify";
import { currentAttribution } from "@/lib/attribution/cookie";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Requests one account may create per hour, and per hashed address per hour. Generous for people, tight for bots. */
const PER_ACCOUNT_LIMIT = 10;
const PER_ADDRESS_LIMIT = 30;

/** A hash, never the raw value: the counter table stores keys only. */
function bucket(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

/** The address the request came from, as the proxy reports it. Empty when unknown: then only the account limit applies. */
async function clientAddress(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for") ?? "";
  return (forwarded.split(",")[0] ?? "").trim() || (h.get("x-real-ip") ?? "").trim();
}

/**
 * Customer submits a new request. Protections, in order:
 *  - a hidden "website" field: a bot that fills it gets a normal-looking redirect and nothing is stored;
 *  - the account must be active (customerSession);
 *  - rate limits per account and per hashed address (migration 0023);
 *  - a one-time submission token per form: a double submit returns the first request, never a second one;
 *  - the lead source is read from the server-side cookie set on the visitor's first visit, never from the form.
 */
export async function createApplicationAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);

  // Honeypot: real visitors never see or fill this field.
  if (String(formData.get("website") ?? "").trim() !== "") {
    redirect(`/${locale}/dashboard`);
  }

  const values = formObject(formData);
  const parsed = parseWith(applicationSchema, {
    ...values,
    consent: formData.get("consent") === "on",
  });
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;

  const token = String(formData.get("submissionToken") ?? "");
  if (!UUID.test(token)) return { ok: false, code: "invalid_input", fieldErrors: { _form: "invalid_option" } };

  const session = await customerSession();
  if (!session.ok) return { ok: false, code: session.code };
  const { supabase, userId } = session;

  const address = await clientAddress();
  const limits: [string, number][] = [[bucket("apply-account", userId), PER_ACCOUNT_LIMIT]];
  if (address) limits.push([bucket("apply-address", address), PER_ADDRESS_LIMIT]);
  for (const [key, limit] of limits) {
    const { data: allowed, error: limitError } = await supabase.rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window: "1 hour" });
    if (limitError) {
      console.error("rate limit check failed", limitError.code);
      return { ok: false, code: "generic" };
    }
    if (allowed !== true) return { ok: false, code: "rate_limited" };
  }

  const attribution = await currentAttribution();

  const { data, error } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      service_id: input.serviceId,
      full_name: input.fullName,
      email: input.email,
      whatsapp: input.whatsapp,
      nationality: input.nationality,
      country_of_residence: input.countryOfResidence,
      destination_country: input.destinationCountry,
      travel_date: input.travelDate || null,
      employment_status: input.employmentStatus,
      previous_travel_history: input.previousTravelHistory,
      additional_info: input.additionalInfo,
      source: input.source || null,
      // The language of this request: emails sent after the owner's decisions use it (migration 0020).
      locale,
      // Where the request came from. "other" when the cookie is missing or blocked: never a guessed channel.
      lead_source: attribution?.source ?? "other",
      lead_source_detail: attribution?.detail ?? null,
      submission_token: token,
    })
    .select("id, reference")
    .single();

  if (error || !data) {
    // A repeated submission of the same form: the first request is the one the customer keeps.
    if (error?.code === "23505") {
      const { data: first } = await supabase
        .from("applications")
        .select("id")
        .eq("user_id", userId)
        .eq("submission_token", token)
        .maybeSingle();
      if (first) redirect(`/${locale}/dashboard/requests/${first.id}?created=1`);
    }
    console.error("createApplicationAction failed", error?.code);
    return { ok: false, code: "generic" };
  }
  queueCustomerEmail(supabase, "application_received", data.id);
  revalidatePath(`/${locale}/dashboard`);
  redirect(`/${locale}/dashboard/requests/${data.id}?created=1`);
}
