import { assertNoPersonalData } from "./security/personal-data";
import type { AgentDefinition } from "./registry";
import type { LLMGateway } from "./llm/gateway";
import { agentInputSchema, type AgentInput } from "./types";

export class OutputValidationError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "OutputValidationError";
  }
}

export class InputValidationError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

export interface AgentResult {
  output: unknown;
  providerId: string;
  source: "mock" | "live";
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

/** Extracts a JSON object from a model reply, tolerating code fences and surrounding prose. */
export function parseJsonLoose(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new OutputValidationError("Model reply contains no JSON object.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new OutputValidationError("Model reply is not valid JSON.");
  }
}

/**
 * Runs one agent: validates input, blocks personal data, calls the gateway, validates output.
 * Agents never call the database or the network directly.
 */
export class AgentRuntime {
  constructor(private readonly gateway: LLMGateway) {}

  async run(def: AgentDefinition, rawInput: AgentInput): Promise<AgentResult> {
    const parsed = agentInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new InputValidationError(`Invalid input for ${def.key}.`);
    const input = parsed.data;

    try {
      assertNoPersonalData(input);
    } catch (error) {
      throw new InputValidationError(error instanceof Error ? error.message : "Personal data blocked.");
    }

    const system = [
      def.prompt.system,
      "Facts: use only the knowledge entries and shared context provided below. Never invent a fact, date, price or requirement.",
      "Boundaries:",
      ...def.boundaries.map((b) => `- ${b}`),
    ].join("\n");
    const user = JSON.stringify({
      objective: input.objective,
      language: input.language,
      country: input.country,
      brief: input.brief,
      data: input.data,
      aggregates: input.aggregates,
      upstream: input.upstream,
      context: input.context,
      knowledge: input.knowledge,
    });

    const response = await this.gateway.complete({
      system,
      user,
      maxOutputTokens: 1200,
      timeoutMs: def.timeoutMs,
      mockOutput: def.mockOutput(input),
    });

    const json = parseJsonLoose(response.text);
    const checked = def.outputSchema.safeParse(json);
    if (!checked.success) {
      throw new OutputValidationError(`Output for ${def.key} does not match its contract.`);
    }
    return {
      output: checked.data,
      providerId: response.providerId,
      source: response.source,
      promptVersion: def.prompt.version,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    };
  }
}

