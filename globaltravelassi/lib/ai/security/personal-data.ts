const FORBIDDEN_KEYS = new Set([
  "email",
  "phone",
  "whatsapp",
  "full_name",
  "first_name",
  "last_name",
  "national_id",
  "passport",
  "storage_path",
  "document",
  "documents",
  "file_name",
  "address",
  "birth_date",
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+|00)\d{8,15}|\b0[5-7]\d{8}\b/;

export class PersonalDataError extends Error {
  constructor(public readonly path: string) {
    super(`Personal data is not allowed in agent context (at ${path}).`);
    this.name = "PersonalDataError";
  }
}

/** Throws if any key or string value looks like personal data. Run before every model call. */
export function assertNoPersonalData(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    if (EMAIL.test(value) || PHONE.test(value)) throw new PersonalDataError(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPersonalData(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new PersonalDataError(`${path}.${key}`);
      assertNoPersonalData(child, `${path}.${key}`);
    }
  }
}
