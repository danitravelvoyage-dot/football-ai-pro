// Only PUBLIC values are read here. Never add a secret (service-role key, database password)
// to this project: anything prefixed NEXT_PUBLIC_ is shipped to every visitor's browser.
export const siteConfig = {
  name: "GLOBALTRAVELASSI",
  brand: "VISORA",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  whatsappNumber: (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/\D/g, ""),
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  documentBucket: "customer-documents",
  maxUploadBytes: 10 * 1024 * 1024,
  allowedUploadTypes: ["application/pdf", "image/jpeg", "image/png"] as const,
};

export function isSupabaseConfigured(): boolean {
  return Boolean(siteConfig.supabaseUrl && siteConfig.supabaseAnonKey);
}

/** wa.me link with a pre-filled message. Returns null when no WhatsApp number is configured. */
export function whatsappLink(message?: string): string | null {
  if (!siteConfig.whatsappNumber) return null;
  const base = `https://wa.me/${siteConfig.whatsappNumber}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
