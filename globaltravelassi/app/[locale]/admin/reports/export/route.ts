import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { getExportRows } from "@/lib/queries";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Excel-compatible CSV of all requests, with their lead source. Administrators only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  void request;
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
    lead_source: string | null; lead_source_detail: string | null; customer_category: string; locale: string;
    last_contacted_at: string | null;
    services: { title_en: string } | null;
  };
  const rows = (await getExportRows()) as unknown as Row[];
  const header = [
    "Reference", "Created", "Full name", "Email", "WhatsApp", "Nationality", "Destination", "Service", "Status",
    "Lead source", "Campaign tag", "Customer category", "Request language", "Last contact",
  ];
  const lines = rows.map((r) => [
    r.reference,
    r.created_at.slice(0, 10),
    r.full_name,
    r.email,
    r.whatsapp,
    r.nationality,
    r.destination_country,
    r.services?.title_en ?? "",
    r.status,
    r.lead_source ?? "not_recorded",
    r.lead_source_detail ?? "",
    r.customer_category,
    r.locale,
    r.last_contacted_at ? r.last_contacted_at.slice(0, 10) : "",
  ].map(csvCell).join(","));
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
