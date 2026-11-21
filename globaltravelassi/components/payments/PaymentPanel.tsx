"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { submitPaymentEvidenceAction } from "@/lib/actions/payments";
import { siteConfig } from "@/lib/config";
import { checkProof, PROOF_MIME_TYPES, PROOF_MAX_BYTES, proofPathFor } from "@/lib/payments/rules";

export type PaymentLabels = Record<string, string>;

export interface OfferedMethod {
  method: string;
  label: string;
  instructions: string;
}

/** Shows the amount and the methods the owner offers, then takes the proof: the file goes to the private bucket first. */
export function PaymentPanel({ applicationId, userId, amountText, methods, labels }: {
  applicationId: string;
  userId: string;
  amountText: string;
  methods: OfferedMethod[];
  labels: PaymentLabels;
}) {
  const router = useRouter();
  const [method, setMethod] = useState(methods[0]?.method ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const chosen = methods.find((m) => m.method === method);

  // Maps the action's codes to the labels in the visitor's language.
  const codeLabel = (code: string) => {
    const key: Record<string, string> = {
      not_open: "notOpen", unavailable: "unavailable", no_price: "noPrice", invalid_file: "invalidFile", file_missing: "fileMissing",
      invalid_path: "invalidPath", already_waiting: "alreadyWaiting", already_paid: "paid", not_found: "notFound", unauthorized: "unauthorized",
    };
    return labels[key[code] ?? "generic"] ?? labels.generic;
  };

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !chosen) return;
    setMessage(null);
    const storagePath = proofPathFor(userId, applicationId, file.name, crypto.randomUUID());
    const pre = checkProof({ userId, applicationId, path: storagePath, mime: file.type, size: file.size });
    if (!pre.ok) {
      setMessage({ tone: "error", text: labels.invalidFile });
      event.target.value = "";
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      const { error: uploadError } = await supabase.storage
        .from(siteConfig.documentBucket)
        .upload(storagePath, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
      if (uploadError) {
        setMessage({ tone: "error", text: labels.fileMissing });
        return;
      }
      const result = await submitPaymentEvidenceAction({
        applicationId,
        method: chosen.method,
        storagePath,
        mimeType: file.type,
        sizeBytes: file.size,
        fileName: file.name.slice(0, 200),
      });
      if (!result.ok) {
        // A proof the database refused is removed, so nothing is left behind unlisted.
        await supabase.storage.from(siteConfig.documentBucket).remove([storagePath]);
        setMessage({ tone: "error", text: codeLabel(result.code) });
        return;
      }
      setMessage({ tone: "ok", text: labels.submitted });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: labels.generic });
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-navy-700">
        <span className="font-semibold">{labels.price}:</span> {amountText}
      </p>
      {methods.length === 0 ? (
        <p className="text-sm text-navy-600">{labels.noMethods}</p>
      ) : (
        <>
          <div>
            <label htmlFor="payment-method" className="block text-sm font-semibold text-navy-800">{labels.chooseMethod}</label>
            <select id="payment-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy}
              className="mt-2 w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40">
              {methods.map((m) => (
                <option key={m.method} value={m.method}>{m.label}</option>
              ))}
            </select>
          </div>
          {chosen && (
            <div className="rounded-2xl bg-navy-50/70 p-4">
              <p className="text-sm font-semibold text-navy-900">{labels.instructions}</p>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-navy-800">{chosen.instructions}</p>
            </div>
          )}
          <label className={`flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gold-400/70 bg-gold-100/40 px-4 py-4 text-center font-semibold text-navy-800 transition hover:bg-gold-100 ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <span>{busy ? labels.uploading : labels.upload}</span>
            <span className="text-xs font-normal text-navy-600">{labels.proofLabel}</span>
            <input type="file" accept={PROOF_MIME_TYPES.join(",")} onChange={onFile} disabled={busy} className="sr-only" />
          </label>
          <p className="text-xs leading-relaxed text-navy-600">{labels.proofHint}</p>
          <p className="text-xs text-navy-500">{Math.round(PROOF_MAX_BYTES / 1024 / 1024)} MB</p>
        </>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm font-medium ${message.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
