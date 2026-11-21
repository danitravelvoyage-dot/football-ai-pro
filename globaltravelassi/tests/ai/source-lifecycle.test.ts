import { describe, it, expect } from "vitest";
import { ReviewForbiddenError } from "@/lib/ai/review/service";
import { SourceForbiddenError, SourceNotApprovedError, SourceRetiredError, SourceConflictError } from "@/lib/ai/sources/service";
import { SourceRuleError } from "@/lib/ai/sources/rules";
import { buildApprovalServices, seedRetiredHost, TEST_OWNER } from "./approval-fixtures";

const AGENT = { kind: "agent" as const, agent: "MarketResearchAgent" as const };
const SYSTEM = { kind: "system" as const };
const REASON = "Confirmed the official address";

async function active(svc: ReturnType<typeof buildApprovalServices>, host = "visa.example.gov.dz") {
  return svc.sources.add(TEST_OWNER, { host, category: "government", jurisdiction: "dz", purpose: "Visa rules", expiresAt: null }, REASON);
}

describe("source status transitions", () => {
  it("active to disabled and back to active, each with its own reason and audit entry", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    const off = await svc.sources.setStatus(TEST_OWNER, row.host, row.version, "disabled", "Source is down");
    const on = await svc.sources.setStatus(TEST_OWNER, row.host, off.version, "active", "Source is back");
    expect(on).toMatchObject({ status: "active", lastChangeReason: "Source is back" });
    const types = svc.audit.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["source.added", "source.disabled", "source.enabled"]));
    expect(svc.audit.events.find((e) => e.type === "source.disabled")!.meta.reason).toBe("Source is down");
  });

  it("active or disabled can be retired, and retirement keeps the host and its approver", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    const off = await svc.sources.setStatus(TEST_OWNER, row.host, row.version, "disabled", "Paused");
    const retired = await svc.sources.retire(TEST_OWNER, row.host, off.version, "Moved to another address");
    expect(retired).toMatchObject({ host: row.host, status: "retired", approvedBy: TEST_OWNER.id, approvedAt: row.approvedAt });
    expect(await svc.sources.activeHosts()).toEqual([]);
    expect(svc.audit.events.find((e) => e.type === "source.retired")!.meta.previous).toMatchObject({ status: "disabled" });
  });

  it("a retired host refuses every owner change, and nothing is written", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    await expect(svc.sources.setStatus(TEST_OWNER, host, version, "active", REASON)).rejects.toBeInstanceOf(SourceRetiredError);
    await expect(svc.sources.setStatus(TEST_OWNER, host, version, "disabled", REASON)).rejects.toBeInstanceOf(SourceRetiredError);
    await expect(svc.sources.edit(TEST_OWNER, host, version, { category: "other", jurisdiction: "all", purpose: "Other use", expiresAt: null }, REASON)).rejects.toBeInstanceOf(SourceRetiredError);
    await expect(svc.sources.revalidate(TEST_OWNER, host, version, REASON)).rejects.toBeInstanceOf(SourceRetiredError);
    await expect(svc.sources.retire(TEST_OWNER, host, version, REASON)).rejects.toBeInstanceOf(SourceRetiredError);
    expect((await svc.sources.status(host))).toEqual({ status: "retired", version });
  });

  it("every change needs its own non-empty reason", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    await expect(svc.sources.setStatus(TEST_OWNER, row.host, row.version, "disabled", "  ")).rejects.toBeInstanceOf(SourceRuleError);
    await expect(svc.sources.retire(TEST_OWNER, row.host, row.version, "x")).rejects.toBeInstanceOf(SourceRuleError);
    expect((await svc.sources.status(row.host))?.status).toBe("active");
  });

  it("a stale version is refused for every transition", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    await expect(svc.sources.retire(TEST_OWNER, row.host, row.version + 3, REASON)).rejects.toBeInstanceOf(SourceConflictError);
    await expect(svc.sources.setStatus(TEST_OWNER, row.host, row.version + 3, "disabled", REASON)).rejects.toBeInstanceOf(SourceConflictError);
  });

  it("agents and the system can change no status, and no reactivation is requested for them", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    for (const actor of [AGENT, SYSTEM]) {
      await expect(svc.sources.retire(actor, row.host, row.version, REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
      await expect(svc.sources.setStatus(actor, row.host, row.version, "disabled", REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
      await expect(svc.sources.requestReactivation(actor, row.host, row.version, REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
    }
    expect((await svc.sources.status(row.host))?.status).toBe("active");
  });
});

describe("reactivation of a retired host", () => {
  it("is refused until an approved request names this host and this version", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, host, version, "Confirmed the new address");
    await expect(svc.sources.reactivate(TEST_OWNER, host, version, reviewId, "Too early")).rejects.toBeInstanceOf(SourceNotApprovedError);
    expect((await svc.sources.status(host))?.status).toBe("retired");
    expect(svc.audit.events.find((e) => e.type === "source.reactivation_requested")!.meta).toMatchObject({ reviewId });
  });

  it("comes back when the owner approves the request in the approval center, and agents can read it again", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, host, version, "Confirmed the new address");
    await svc.review.decide(TEST_OWNER, reviewId, "approve", "Checked the address again", 1);
    expect((await svc.sources.status(host))).toEqual({ status: "active", version: version + 1 });
    expect(await svc.sources.activeHosts()).toEqual([host]);
    expect(svc.audit.events.find((e) => e.type === "source.reactivated")).toBeDefined();
  });

  it("a rejected request leaves the host retired", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, host, version, "Confirmed the new address");
    await svc.review.decide(TEST_OWNER, reviewId, "reject", "Not enough evidence", 1);
    expect((await svc.sources.status(host))?.status).toBe("retired");
  });

  it("an approval cannot be used twice: the version has moved on after the first reactivation", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, host, version, "First request");
    await svc.review.decide(TEST_OWNER, reviewId, "approve", "Approved once", 1);
    await svc.sources.retire(TEST_OWNER, host, version + 1, "Retired again");
    await expect(svc.sources.reactivate(TEST_OWNER, host, version + 2, reviewId, "Reuse the old approval")).rejects.toBeInstanceOf(SourceNotApprovedError);
    expect((await svc.sources.status(host))?.status).toBe("retired");
  });

  it("refuses to request a reactivation for a host that is not retired", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    await expect(svc.sources.requestReactivation(TEST_OWNER, row.host, row.version, REASON)).rejects.toBeInstanceOf(SourceRuleError);
  });

  it("an approval for a host that was never requested for that host cannot reactivate another one", async () => {
    const svc = buildApprovalServices();
    const a = await seedRetiredHost(svc, "a.gov.dz");
    const b = await seedRetiredHost(svc, "b.gov.dz");
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, a.host, a.version, "For a");
    await svc.review.decide(TEST_OWNER, reviewId, "approve", "Approved for a", 1);
    await expect(svc.sources.reactivate(TEST_OWNER, b.host, b.version, reviewId, "Wrong host")).rejects.toBeInstanceOf(SourceNotApprovedError);
    expect((await svc.sources.status(b.host))?.status).toBe("retired");
  });

  it("agents cannot approve a reactivation in the approval center", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, host, version, "Confirmed");
    await expect(svc.review.decide(AGENT, reviewId, "approve", "Agent approval", 1)).rejects.toBeInstanceOf(ReviewForbiddenError);
    expect((await svc.sources.status(host))?.status).toBe("retired");
  });
});

describe("concurrent writes to one host", () => {
  it("two retirements at the same version: one applies, the other is refused", async () => {
    const svc = buildApprovalServices();
    const row = await active(svc);
    const results = await Promise.allSettled([
      svc.sources.retire(TEST_OWNER, row.host, row.version, "First"),
      svc.sources.retire(TEST_OWNER, row.host, row.version, "Second"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(SourceConflictError);
    expect(svc.audit.events.filter((e) => e.type === "source.retired")).toHaveLength(1);
  });

  it("two approvals of the same reactivation at once: one reactivates, the other is refused", async () => {
    const svc = buildApprovalServices();
    const { host, version } = await seedRetiredHost(svc);
    const reviewId = await svc.sources.requestReactivation(TEST_OWNER, host, version, "Confirmed");
    const results = await Promise.allSettled([
      svc.review.decide(TEST_OWNER, reviewId, "approve", "First approval", 1),
      svc.review.decide(TEST_OWNER, reviewId, "approve", "Second approval", 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(svc.audit.events.filter((e) => e.type === "source.reactivated")).toHaveLength(1);
    expect((await svc.sources.status(host))).toEqual({ status: "active", version: version + 1 });
  });
});
