import { z } from "zod";
import {
  applicationStatuses, contactChannels, currencies, customerCategories, documentTypes, employmentStatuses, leadSources,
  serviceCategories,
} from "@/lib/domain";
import { isCountryCode } from "@/lib/countries";
import { siteConfig } from "@/lib/config";

// Error messages are CODES. The UI translates them (see lib/validation/messages.ts).
const uuid = z.string().uuid("invalid_option");
const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { errorMap: () => ({ message: "invalid_option" }) });
const text = (max: number, min = 0) => z.string().trim().min(min, min > 0 ? "required" : undefined).max(max, "too_long");
const country = z.string().trim().toUpperCase().refine(isCountryCode, "invalid_option");

/** Accepts +213 555 000 111, 00213…, or an Algerian local mobile 0555 000 111. Returns E.164-like "+digits". */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => {
    const compact = value.replace(/[\s.\-()]/g, "");
    if (/^0[5-7]\d{8}$/.test(compact)) return `+213${compact.slice(1)}`;
    if (compact.startsWith("00")) return `+${compact.slice(2)}`;
    return compact;
  })
  .refine((value) => /^\+?[0-9]{8,15}$/.test(value), "invalid_phone")
  .transform((value) => (value.startsWith("+") ? value : `+${value}`));

const emailSchema = z.string().trim().toLowerCase().email("invalid_email").max(254, "too_long");

const dateString = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "invalid_date")
  .refine((value) => value === "" || !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "invalid_date");

const todayIso = () => new Date().toISOString().slice(0, 10);

export const applicationSchema = z.object({
  fullName: text(120, 2),
  email: emailSchema,
  whatsapp: phoneSchema,
  nationality: country,
  countryOfResidence: country,
  destinationCountry: country,
  serviceId: uuid,
  travelDate: dateString.refine((value) => value === "" || value >= todayIso(), "invalid_date"),
  employmentStatus: oneOf(employmentStatuses),
  previousTravelHistory: text(2000),
  additionalInfo: text(2000),
  source: text(100),
  consent: z.literal(true, { errorMap: () => ({ message: "required" }) }),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;

export const passwordSchema = z
  .string()
  .min(8, "weak")
  .max(72, "too_long")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "weak");

export const registerSchema = z
  .object({
    fullName: text(120, 2),
    whatsapp: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, { message: "mismatch", path: ["confirmPassword"] });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "required").max(72, "too_long"),
});

export const profileSchema = z.object({
  fullName: text(120, 2),
  whatsapp: phoneSchema,
});

export const documentSchema = z.object({
  applicationId: uuid,
  docType: oneOf(documentTypes),
  fileName: text(200, 1),
  mimeType: oneOf(siteConfig.allowedUploadTypes),
  sizeBytes: z.coerce.number().int().min(1, "invalid_option").max(siteConfig.maxUploadBytes, "file_too_large"),
  storagePath: z.string().min(3).max(500),
});

export const statusSchema = z.object({
  applicationId: uuid,
  status: oneOf(applicationStatuses),
  message: text(300),
});

/** The owner's correction of a lead source. The reason is recorded with the change. */
export const leadSourceSchema = z.object({
  applicationId: uuid,
  leadSource: oneOf(leadSources),
  reason: text(300, 3),
});

export const customerCategorySchema = z.object({
  applicationId: uuid,
  category: oneOf(customerCategories),
});

export const contactSchema = z.object({
  applicationId: uuid,
  channel: oneOf(contactChannels),
  note: text(300),
});

export const noteSchema = z.object({
  applicationId: uuid,
  body: text(2000, 1),
});

const optionalPrice = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value.replace(",", "."))))
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 100_000_000), "invalid_option");

export const serviceSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")).transform((value) => value || undefined),
  slug: z.string().trim().regex(/^[a-z0-9-]{3,60}$/, "invalid_option"),
  category: oneOf(serviceCategories),
  titleAr: text(120, 2),
  titleFr: text(120, 2),
  titleEn: text(120, 2),
  descAr: text(1000),
  descFr: text(1000),
  descEn: text(1000),
  price: optionalPrice,
  currency: oneOf(currencies),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});
export type ServiceInput = z.infer<typeof serviceSchema>;
