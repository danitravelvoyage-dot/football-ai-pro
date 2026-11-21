"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applicationSchema } from "@/lib/validation/schemas";
import { formObject, localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";
import { customerSession } from "./customer-session";
import { queueCustomerEmail } from "@/lib/email/notify";

/** Customer submits a new request. The database re-checks ownership, status and service. */
export async function createApplicationAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const values = formObject(formData);
  const parsed = parseWith(applicationSchema, {
    ...values,
    consent: formData.get("consent") === "on",
  });
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;

  const session = await customerSession();
  if (!session.ok) return { ok: false, code: session.code };
  const { supabase, userId } = session;

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
    })
    .select("id, reference")
    .single();

  if (error || !data) {
    console.error("createApplicationAction failed", error?.code);
    return { ok: false, code: "generic" };
  }
  queueCustomerEmail(supabase, "application_received", data.id);
  revalidatePath(`/${locale}/dashboard`);
  redirect(`/${locale}/dashboard/requests/${data.id}?created=1`);
}
