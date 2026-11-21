import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteConfig } from "@/lib/config";
import { readEmailConfig } from "./config";
import { createSmtpTransport } from "./transport";
import { isCustomerEmailKind, notifyCustomer, retryFailedEmails, type EmailDeps, type EmailStore, type QueuedEmail } from "./service";
import type { CustomerEmailKind, EmailTemplateData } from "./kinds";

type Row = { email_id: string; email_kind?: string; email_recipient: string; email_locale: string; email_data: EmailTemplateData; email_status?: string };

function toQueued(row: Row, kind: CustomerEmailKind): QueuedEmail {
  return {
    id: row.email_id,
    kind,
    recipient: row.email_recipient ?? "",
    locale: row.email_locale,
    data: row.email_data,
    status: row.email_status === "skipped" ? "skipped" : "pending",
  };
}

/** The email log in the database (migration 0021), used with the session of whoever acted. */
export function supabaseEmailStore(supabase: SupabaseClient): EmailStore {
  return {
    async enqueue(kind, subjectId) {
      const { data, error } = await supabase.rpc("enqueue_customer_email", { p_kind: kind, p_subject: subjectId });
      if (error) throw new Error("enqueue_failed");
      const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      return row?.email_id ? toQueued(row, kind) : null;
    },
    async record(id, status, error, messageId) {
      const { error: rpcError } = await supabase.rpc("record_customer_email_delivery", {
        p_id: id,
        p_status: status,
        p_error: error,
        p_message_id: messageId,
      });
      if (rpcError) throw new Error("record_failed");
    },
    async claimRetry(id) {
      const { data, error } = await supabase.rpc("claim_customer_email_retry", { p_id: id });
      if (error) throw new Error("claim_failed");
      const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
      if (!row?.email_id || !row.email_kind || !isCustomerEmailKind(row.email_kind)) return null;
      return toQueued(row, row.email_kind);
    },
  };
}

function emailDeps(supabase: SupabaseClient): EmailDeps {
  const config = readEmailConfig();
  return {
    store: supabaseEmailStore(supabase),
    transport: config.ok ? createSmtpTransport(config.config) : null,
    siteUrl: siteConfig.siteUrl,
    brand: siteConfig.brand,
    log: (message) => console.error(message),
  };
}

/**
 * Sends the email after the response has gone out, so the visitor never waits for the mail server. Outside a request
 * (tests, scripts) it runs at once. Never throws.
 */
export function queueCustomerEmail(supabase: SupabaseClient, kind: CustomerEmailKind, subjectId: string): void {
  const run = async () => {
    try {
      await notifyCustomer(kind, subjectId, emailDeps(supabase));
    } catch {
      console.error(`customer email ${kind}: unexpected error`);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Owner: retry the failed emails in the log (at most five attempts each). */
export async function retryFailedCustomerEmails(supabase: SupabaseClient, ids: string[]) {
  return retryFailedEmails(ids, emailDeps(supabase));
}
