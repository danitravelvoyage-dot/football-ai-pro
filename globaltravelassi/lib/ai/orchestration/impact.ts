import type { TaskStore } from "./store";
import { downstreamOf, type GraphNode } from "./graph";

/** Ids of every task that depends, directly or indirectly, on the given task. Dependencies stay inside one run. */
export async function impactOfTask(store: TaskStore, taskId: string): Promise<string[]> {
  const task = await store.getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);
  const tasks = await store.listTasksByRunIds([task.runId]);
  const nodes: GraphNode[] = tasks.map((t) => ({ id: t.id, status: t.status, dependsOn: t.dependsOn }));
  return downstreamOf(nodes, taskId);
}
