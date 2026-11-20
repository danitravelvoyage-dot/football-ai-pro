import type { AgentKey } from "./types";

/** Tools agents may ask for. There is no tool that sends, pays, publishes, deploys or runs SQL. */
export const TOOL_NAMES = [
  "store.readAggregates",
  "store.readKnowledge",
  "store.saveArtifact",
  "store.saveMemory",
  "approval.propose",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export class ToolPermissionError extends Error {
  constructor(
    public readonly agent: AgentKey,
    public readonly tool: ToolName,
  ) {
    super(`Agent ${agent} is not allowed to use tool ${tool}.`);
    this.name = "ToolPermissionError";
  }
}

export function assertToolAllowed(agent: AgentKey, tool: ToolName, allowed: readonly ToolName[]): void {
  if (!allowed.includes(tool)) throw new ToolPermissionError(agent, tool);
}
