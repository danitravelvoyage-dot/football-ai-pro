"use server";

import { revalidatePath } from "next/cache";
import { siteConfig } from "@/lib/config";
import { documentSchema } from "@/lib/validation/schemas";
import { parseWith } from "./helpers";
import type { ActionState } from "./types";
import { customerSession } from "./customer-session";
import { queueCustomerEmail } from "@/lib/email/notify";

/**
 * Called AFTER the browser has uploaded the file to the private bucket under
 * <user_id>/<application_id>/<file>. Registers the metadata. Row Level Security
 * rejects it when the request is no longer open for documents.
 */
export async function registerDocumentAction(input: {
  applicationId: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  locale: string;
}): Promise<ActionState> {
  const parsed = parseWith(documentSchema, input);
  if (!parsed.ok) return parsed.state;

  const session = await customerSession();
  if (!session.ok) return { ok: false, code: session.code };
  const { supabase, userId } = session;
  if (!parsed.data.storagePath.startsWith(`${userId}/${parsed.data.applicationId}/`)) {
    return { ok: false, code: "unauthorized" };
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      application_id: parsed.data.applicationId,
      user_id: userId,
      doc_type: parsed.data.docType,
      storage_path: parsed.data.storagePath,
      file_name: parsed.data.fileName,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Usually the request is already under review: remove the orphaned file.
    await supabase.storage.from(siteConfig.documentBucket).remove([parsed.data.storagePath]);
    return { ok: false, code: "locked" };
  }
  queueCustomerEmail(supabase, "document_upload_confirmed", data.id);
  revalidatePath("/", "layout");
  return { ok: true, code: "document_added", id: data.id };
}

export async function deleteDocumentAction(formData: FormData): Promise<ActionState> {
  const documentId = String(formData.get("documentId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return { ok: false, code: "not_found" };
  const session = await customerSession();
  if (!session.ok) return { ok: false, code: session.code };
  const { supabase } = session;
  const { data: doc } = await supabase.from("documents").select("id, storage_path").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false, code: "not_found" };

  const { data: deleted, error } = await supabase.from("documents").delete().eq("id", documentId).select("id");
  if (error || !deleted?.length) return { ok: false, code: "locked" };

  await supabase.storage.from(siteConfig.documentBucket).remove([doc.storage_path]);
  revalidatePath("/", "layout");
  return { ok: true, code: "document_removed" };
}
