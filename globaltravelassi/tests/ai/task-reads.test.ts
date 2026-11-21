import { describe, it, expect, vi } from "vitest";
import { makeHarness, startInput } from "./helpers";
import { fakeSupabase } from "./supabase-fake";
import { MemoryTaskStore } from "@/lib/ai/orchestration/store";
import { SupabaseTaskStore } from "@/lib/ai/store/supabase-store";
import type { TaskStatus } from "@/lib/ai/types";

vi.mock("server-only", () => ({}));

const BASE = Date.parse("2026-11-20T09:00:00.000Z");

/** Rows shaped like ai_tasks. `index` drives the creation time so ordering can be checked. */
function row(index: number, overrides: Record<string, unknown> = {}) {
  const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  return {
    id,
    run_id: "11111111-1111-4000-8000-000000000001",
    status: "pending",
    created_at: new Date(BASE + index * 1000).toISOString(),
    title: `Task ${index}`,
    agent: "SalesAgent",
    ...overrides,
  };
}

function storeWith(rows: Record<string, unknown>[], maxRows?: number) {
  return new SupabaseTaskStore(fakeSupabase({ ai_tasks: rows }, { maxRows }));
}

describe("Supabase task reads (query double)", () => {
  it("pages newest first and returns every row exactly once, including rows that share a timestamp", async () => {
    const distinct = Array.from({ length: 1000 }, (_, i) => row(i));
    const tied = Array.from({ length: 234 }, (_, i) => row(1000 + i, { created_at: new Date(BASE + 999_000).toISOString() }));
    const store = storeWith([...distinct, ...tied]);

    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    let pages = 0;
    do {
      const page = await store.listTasksPage({ limit: 100, after: cursor });
      seen.push(...page.items.map((t) => t.id));
      cursor = page.next ?? undefined;
      pages += 1;
    } while (cursor && pages < 100);

    expect(seen).toHaveLength(1234);
    expect(new Set(seen).size).toBe(1234);
    // The tied rows share the newest timestamp, so the id tie-break puts the highest id first.
    expect(seen[0]).toBe(tied[tied.length - 1].id);
  });

  it("lists every open task across server pages and never returns finished ones", async () => {
    const open = Array.from({ length: 1300 }, (_, i) => row(i, { status: i % 2 ? "ready" : "pending" }));
    const finished = Array.from({ length: 200 }, (_, i) => row(2000 + i, { status: "succeeded" as TaskStatus }));
    const store = storeWith([...open, ...finished], 1000);

    const tasks = await store.listOpenTasks();
    expect(tasks).toHaveLength(1300);
    expect(tasks.every((t) => t.status !== "succeeded")).toBe(true);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(1300);
  });

  it("keeps every task of a run when the run has more rows than one server response returns", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(i));
    const store = storeWith(rows, 1000);
    const tasks = await store.listTasksByRunIds(["11111111-1111-4000-8000-000000000001"]);
    expect(tasks).toHaveLength(1200);
  });

  it("finds a task by id even when it is far beyond the old 500 row limit", async () => {
    const rows = Array.from({ length: 800 }, (_, i) => row(i));
    const store = storeWith(rows);
    expect((await store.getTask(rows[0].id as string))?.title).toBe("Task 0");
    expect((await store.getTask(rows[799].id as string))?.title).toBe("Task 799");
    expect(await store.getTask("99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  it("returns exact status counts above the old 5000 row sample", async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => row(i));
    const counts = await storeWith(rows).countTasksByStatus();
    expect(counts.pending).toBe(6000);
    expect(counts.succeeded).toBe(0);
  });

  it("refuses a cursor that is not in the database format", async () => {
    const store = storeWith([row(0)]);
    await expect(
      store.listTasksPage({ limit: 10, after: { createdAt: "2026-01-01T00:00:00Z,id.eq.x", id: "not-a-uuid" } }),
    ).rejects.toThrow("Invalid task cursor.");
  });
});

describe("in-memory task reads share the same contract", () => {
  it("pages newest first with a stable cursor", async () => {
    const h = makeHarness();
    await h.orch.startWorkflow(startInput());
    await h.orch.startWorkflow(startInput({ idempotencyKey: "run-key-0002" }));
    const store = h.store as MemoryTaskStore;
    const first = await store.listTasksPage({ limit: 5 });
    const second = await store.listTasksPage({ limit: 5, after: first.next ?? undefined });
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    expect(first.items[0].createdAt >= first.items[first.items.length - 1].createdAt).toBe(true);
  });

  it("the scheduler advances every run, not only the oldest 500 tasks", async () => {
    const h = makeHarness();
    const runs: string[] = [];
    for (let i = 0; i < 80; i++) {
      const started = await h.orch.startWorkflow(startInput({ idempotencyKey: `run-key-${String(i).padStart(4, "0")}-xx` }));
      runs.push(started.runId);
    }
    for (let pass = 0; pass < 60; pass++) {
      const report = await h.orch.tick({ limit: 50 });
      if (report.claimed === 0) break;
    }
    for (const runId of runs) {
      const tasks = await h.store.listTasksByRunIds([runId]);
      const byStep = Object.fromEntries(tasks.map((t) => [t.stepKey, t.status]));
      expect(byStep.research).toBe("succeeded");
      // Compliance outputs are held for the owner, so every run stops at that review.
      expect(byStep.compliance).toBe("waiting_approval");
      expect(byStep.approval).toBe("pending");
    }
    // Each run leaves two open tasks: the compliance step held for the owner, and the publishing step behind it.
    expect(await h.store.listOpenTasks()).toHaveLength(160);
  });
});
