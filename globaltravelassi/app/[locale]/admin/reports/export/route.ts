import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { getExportRows } from "@/lib/queries";
import { isLocale, defaultLocale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formula injection, then escape quotes.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Excel-compatible CSV of all requests and their RECEIVED payments. Admins only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : defaultLocale;
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  if (!user || !profile || profile.role !== "admin" || !profile.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  type Row = {
    reference: string; full_name: string; email: string; whatsapp: string; nationality: string;
    destination_country: string; status: string; source: string | null; created_at: string;
    services: { title_en: string; title_fr: string; title_ar: string; category: string } | null;
    payments: { amount: string | number; currency: string; status: string; received_at: string | null }[];
  };
  const rows = (await getExportRows()) as unknown as Row[];
  const header = ["Reference", "Created", "Full name", "Email", "WhatsApp", "Nationality", "Destination", "Service", "Status", "Source", "Received payments"];
  const lines = rows.map((r) => {
    const received = (r.payments ?? [])
      .filter((p) => p.status === "received")
      .map((p) => `${Number(p.amount).toFixed(2)} ${p.currency}`)
      .join("; ");
    return [
      r.reference, r.created_at.slice(0, 10), r.full_name, r.email, r.whatsapp, r.nationality, r.destination_country,
      r.services?.title_en ?? "", r.status, r.source ?? "", received,
    ].map(csvCell).join(",");
  });
  const csv = "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="globaltravelassi-requests-${stamp}-${locale}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
