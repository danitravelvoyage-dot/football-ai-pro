import { describe, expect, it } from "vitest";
import { isServiceSlug, servicePageSlug, SERVICE_SLUGS } from "@/lib/service-slugs";
import { businessServiceSlugs } from "@/lib/services-content";

describe("service slugs used by the middleware", () => {
  it("match exactly the services that have page content", () => {
    expect([...SERVICE_SLUGS].sort()).toEqual([...businessServiceSlugs].sort());
  });

  it("recognise known slugs only", () => {
    expect(isServiceSlug("e-visa")).toBe(true);
    expect(isServiceSlug("european-trips")).toBe(false);
    expect(isServiceSlug("E-VISA")).toBe(false);
    expect(isServiceSlug("")).toBe(false);
  });

  it("extract the slug from service page paths only", () => {
    expect(servicePageSlug("/en/services/e-visa")).toBe("e-visa");
    expect(servicePageSlug("/ar/services/e-visa/")).toBe("e-visa");
    expect(servicePageSlug("/fr/services/not-a-service")).toBe("not-a-service");
    expect(servicePageSlug("/en/services")).toBeNull();
    expect(servicePageSlug("/en/services/e-visa/extra")).toBeNull();
    expect(servicePageSlug("/de/services/e-visa")).toBeNull();
    expect(servicePageSlug("/en/apply")).toBeNull();
  });
});
