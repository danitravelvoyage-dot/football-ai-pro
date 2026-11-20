import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "./supabase-fake";
import { SupabaseTaskStore } from "@/lib/ai/store/supabase-store";

vi.mock("server-only", () => ({}));

const BASE = Date.parse("2026-11-20T09:00:00.000Z");

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function approvalRow(n: number, status = "pending") {
  return {
    id: uuid(n),
    task_id: uuid(90_000 + n),
    artifact_id: null,
    action_class: "external_send_message",
    risk_level: "low",
    summary: `Message ${n}`,
    preview: { n },
    status,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    created_at: new Date(BASE + n * 1000).toISOString(),
    expires_at: new Date(BASE + 24 * 3_600_000 + n * 1000).toISOString(),
    payload_hash: "a".repeat(64),
    executed_at: null,
  };
}

describe("Supabase approval reads have no fixed cap", () => {
  it("reads every pending approval across server responses of at most 1000 rows", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => approvalRow(i + 1));
    const store = new SupabaseTaskStore(fakeSupabase({ ai_approvals: rows }, { maxRows: 1000 }));
    const pending = await store.listApprovals("pending");
    expect(pending).toHaveLength(1200);
    expect(new Set(pending.map((a) => a.id)).size).toBe(1200);
    expect(pending.every((a) => a.status === "pending")).toBe(true);
  });

  it("maps the expiry, fingerprint and execution fields", async () => {
    const store = new SupabaseTaskStore(fakeSupabase({ ai_approvals: [approvalRow(1)] }));
    const [approval] = await store.listApprovals("pending");
    expect(approval.expiresAt).toBe(new Date(BASE + 24 * 3_600_000 + 1000).toISOString());
    expect(approval.payloadHash).toBe("a".repeat(64));
    expect(approval.executedAt).toBeNull();
  });

  it("a cursor from another table or in the wrong shape is refused", async () => {
    const store = new SupabaseTaskStore(fakeSupabase({ ai_approvals: [approvalRow(1)] }));
    await expect(store.listApprovalsPage({ limit: 10, after: { createdAt: "x,id.eq.1", id: uuid(1) } })).rejects.toThrow("Invalid task cursor.");
  });
});
