import { describe, it, expect } from "vitest";
import { applicationSchema, phoneSchema, registerSchema, documentSchema, serviceSchema, leadSourceSchema } from "@/lib/validation/schemas";

const validApplication = {
  fullName: "Amina Benali",
  email: "Amina@Example.dz",
  whatsapp: "0555 12 34 56",
  nationality: "dz",
  countryOfResidence: "DZ",
  destinationCountry: "FR",
  serviceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  travelDate: "",
  employmentStatus: "employed",
  previousTravelHistory: "",
  additionalInfo: "",
  source: "tiktok",
  consent: true,
};

describe("phone numbers", () => {
  it("converts Algerian local mobile numbers to international format", () => {
    expect(phoneSchema.parse("0555 12 34 56")).toBe("+213555123456");
  });
  it("keeps numbers that already have a country code", () => {
    expect(phoneSchema.parse("+213 555 12 34 56")).toBe("+213555123456");
  });
  it("accepts 00-prefixed international numbers", () => {
    expect(phoneSchema.parse("0033 6 12 34 56 78")).toBe("+33612345678");
  });
  it("rejects text and too-short numbers", () => {
    expect(() => phoneSchema.parse("call me")).toThrow();
    expect(() => phoneSchema.parse("12345")).toThrow();
  });
});

describe("application form", () => {
  it("accepts a complete valid request and normalises it", () => {
    const parsed = applicationSchema.parse(validApplication);
    expect(parsed.email).toBe("amina@example.dz");
    expect(parsed.nationality).toBe("DZ");
    expect(parsed.whatsapp).toBe("+213555123456");
  });

  it("requires the privacy consent", () => {
    const result = applicationSchema.safeParse({ ...validApplication, consent: false });
    expect(result.success).toBe(false);
  });

  it("rejects countries outside the supported list", () => {
    expect(applicationSchema.safeParse({ ...validApplication, destinationCountry: "XX" }).success).toBe(false);
  });

  it("rejects an unknown employment status", () => {
    expect(applicationSchema.safeParse({ ...validApplication, employmentStatus: "pirate" }).success).toBe(false);
  });

  it("rejects a travel date in the past but accepts today or later", () => {
    expect(applicationSchema.safeParse({ ...validApplication, travelDate: "2001-01-01" }).success).toBe(false);
    const future = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    expect(applicationSchema.safeParse({ ...validApplication, travelDate: future }).success).toBe(true);
  });

  it("limits free-text length", () => {
    expect(applicationSchema.safeParse({ ...validApplication, additionalInfo: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("registration", () => {
  const base = { fullName: "Yacine K", whatsapp: "0666000111", email: "y@example.dz", password: "secret123", confirmPassword: "secret123" };
  it("accepts a strong password", () => {
    expect(registerSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a password without a number", () => {
    expect(registerSchema.safeParse({ ...base, password: "onlyletters", confirmPassword: "onlyletters" }).success).toBe(false);
  });
  it("rejects mismatched confirmation", () => {
    const result = registerSchema.safeParse({ ...base, confirmPassword: "secret124" });
    expect(result.success).toBe(false);
  });
});

describe("lead source correction", () => {
  const base = { applicationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", leadSource: "tiktok", reason: "Campaign tag was missing" };
  it("accepts a known source with a reason", () => {
    expect(leadSourceSchema.safeParse(base).success).toBe(true);
  });
  it("refuses an unknown source and a missing reason", () => {
    expect(leadSourceSchema.safeParse({ ...base, leadSource: "newspaper" }).success).toBe(false);
    expect(leadSourceSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
  });
});

describe("uploads", () => {
  const base = { applicationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", docType: "passport", fileName: "passport.pdf", mimeType: "application/pdf", sizeBytes: 1024, storagePath: "u/a/p.pdf" };
  it("accepts PDF, JPEG and PNG under 10 MB", () => {
    expect(documentSchema.safeParse(base).success).toBe(true);
    expect(documentSchema.safeParse({ ...base, mimeType: "image/png" }).success).toBe(true);
  });
  it("rejects other file types (for example Word or executables)", () => {
    expect(documentSchema.safeParse({ ...base, mimeType: "application/msword" }).success).toBe(false);
    expect(documentSchema.safeParse({ ...base, mimeType: "application/x-msdownload" }).success).toBe(false);
  });
  it("rejects files over 10 MB", () => {
    expect(documentSchema.safeParse({ ...base, sizeBytes: 10 * 1024 * 1024 + 1 }).success).toBe(false);
  });
});

describe("services", () => {
  const base = {
    id: "", slug: "visa-france", category: "visa", titleAr: "تأشيرة", titleFr: "Visa", titleEn: "Visa",
    descAr: "", descFr: "", descEn: "", price: "", currency: "DZD", isActive: true, sortOrder: "3",
  };
  it("treats an empty price as 'price on request'", () => {
    expect(serviceSchema.parse(base).price).toBeNull();
  });
  it("accepts a numeric price with a decimal comma", () => {
    expect(serviceSchema.parse({ ...base, price: "12000,5" }).price).toBe(12000.5);
  });
  it("rejects slugs with capitals or spaces", () => {
    expect(serviceSchema.safeParse({ ...base, slug: "Visa France" }).success).toBe(false);
  });
});
