"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { registerDocumentAction } from "@/lib/actions/documents";
import { siteConfig } from "@/lib/config";
import { documentTypes } from "@/lib/domain";

type Labels = {
  docType: string; chooseFile: string; uploading: string; uploaded: string; limits: string;
  fileTooLarge: string; fileType: string; genericError: string; locked: string; typeLabels: Record<string, string>;
};

/** Uploads straight to the private bucket with the visitor's own session, then registers the file. */
export function DocumentUploader({ applicationId, userId, locale, labels }: {
  applicationId: string; userId: string; locale: string; labels: Labels;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>("passport");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    if (!(siteConfig.allowedUploadTypes as readonly string[]).includes(file.type)) {
      setMessage({ tone: "error", text: labels.fileType });
      event.target.value = "";
      return;
    }
    if (file.size > siteConfig.maxUploadBytes || file.size === 0) {
      setMessage({ tone: "error", text: labels.fileTooLarge });
      event.target.value = "";
      return;
    }

    setBusy(true);
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "document";
    const storagePath = `${userId}/${applicationId}/${crypto.randomUUID()}-${safeName}`;
    try {
      const supabase = createBrowserSupabase();
      const { error: uploadError } = await supabase.storage
        .from(siteConfig.documentBucket)
        .upload(storagePath, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
      if (uploadError) {
        setMessage({ tone: "error", text: labels.genericError });
        return;
      }
      const result = await registerDocumentAction({
        applicationId,
        docType,
        fileName: file.name.slice(0, 200),
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath,
        locale,
      });
      if (!result.ok) {
        await supabase.storage.from(siteConfig.documentBucket).remove([storagePath]);
        setMessage({ tone: "error", text: result.code === "locked" ? labels.locked : labels.genericError });
        return;
      }
      setMessage({ tone: "ok", text: labels.uploaded });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: labels.genericError });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="doc-type" className="block text-sm font-semibold text-navy-800">{labels.docType}</label>
        <select id="doc-type" value={docType} onChange={(e) => setDocType(e.target.value)} className="mt-2 w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40">
          {documentTypes.map((t) => (
            <option key={t} value={t}>{labels.typeLabels[t]}</option>
          ))}
        </select>
      </div>
      <label className={`flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-gold-400/70 bg-gold-100/40 px-4 py-4 text-center font-semibold text-navy-800 transition hover:bg-gold-100 ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <span>{busy ? labels.uploading : labels.chooseFile}</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={onChange}
          disabled={busy}
          className="sr-only"
        />
      </label>
      <p className="text-xs text-navy-500">{labels.limits}</p>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm font-medium ${message.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
