import { describe, it, expect } from "vitest";
import { AGENT_REGISTRY, listAgents } from "@/lib/ai/registry";
import { AGENT_KEYS, agentInputSchema } from "@/lib/ai/types";
import { TOOL_NAMES } from "@/lib/ai/tools";

const sampleInput = agentInputSchema.parse({
  objective: "Test objective",
  language: "fr",
  country: "dz",
  brief: "brief",
});

describe("agent registry", () => {
  it("registers exactly the sixteen required agents", () => {
    expect(AGENT_KEYS).toHaveLength(16);
    expect(listAgents().map((a) => a.key).sort()).toEqual([...AGENT_KEYS].sort());
    expect(new Set(AGENT_KEYS).size).toBe(16);
  });

  it("gives every agent a mission, boundaries, a versioned prompt and a timeout", () => {
    for (const agent of listAgents()) {
      expect(agent.mission.length).toBeGreaterThan(10);
      expect(agent.boundaries.length).toBeGreaterThanOrEqual(2);
      expect(agent.prompt.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(agent.prompt.system).toContain(agent.name);
      expect(agent.timeoutMs).toBeGreaterThan(0);
      expect(agent.maxAttempts).toBeGreaterThan(0);
    }
  });

  it("every agent forbids sending, publishing, paying, deploying and claiming completion", () => {
    for (const agent of listAgents()) {
      const text = agent.boundaries.join(" ").toLowerCase();
      expect(text).toContain("never send, publish, pay, deploy");
      expect(text).toContain("never state that an external action was completed");
    }
  });

  it("only grants tools that exist in the tool registry", () => {
    const known = new Set<string>(TOOL_NAMES);
    for (const agent of listAgents()) {
      for (const tool of agent.tools) expect(known.has(tool)).toBe(true);
    }
  });

  it("no agent is granted an external action tool (the tool list has none)", () => {
    for (const tool of TOOL_NAMES) expect(tool.startsWith("external")).toBe(false);
  });

  it("each mock output satisfies the agent's output contract", () => {
    for (const agent of listAgents()) {
      const parsed = agent.outputSchema.safeParse(agent.mockOutput(sampleInput));
      expect(parsed.success, `${agent.key} mock output`).toBe(true);
    }
  });

  it("the SalesAgent cannot read contact fields: its output contract has no personal field names", () => {
    const sales = AGENT_REGISTRY.SalesAgent;
    const shape = JSON.stringify(sales.outputSchema.description ?? "") + JSON.stringify(Object.keys((sales.outputSchema as unknown as { shape?: object }).shape ?? {}));
    expect(shape).not.toMatch(/email|phone|whatsapp|full_name/);
  });
});
