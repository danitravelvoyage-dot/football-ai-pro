# GLOBALTRAVELASSI: Vercel AI SDK architecture audit

Date: 22 November 2026. Type: read-only audit. Nothing was installed, changed, committed, pushed or deployed. No database, migration, environment variable or production system was accessed.

Evidence sources:
- The application: `globaltravelassi/` at commit `cf6e966`, branch `feature/ai-marketing-command-center`.
- The SDK: `https://github.com/vercel/ai`, shallow clone at commit `d55f3cf` in `/home/user/vercel/ai` (outside the project). The packages read are `ai` 7.0.179, `@ai-sdk/openai-compatible` 3.0.94, `@ai-sdk/react` 4.0.183, `@ai-sdk/workflow` 2.0.111 and `@ai-sdk/provider` 4.0.39. The versions published on npm may differ, so verify them before any install.

Scope note: the AI back office (`lib/ai/`, the command-center pages, the scheduler and migrations `0002`–`0018`) is **deferred** and is not part of the customer launch. This audit assesses it for a future phase.

---

## 1. Recommendation

**PARTIAL ADOPTION, deferred to the AI back-office phase. Do not adopt now.**

Reasons, from the evidence:

1. The application's AI value is not in model calls. It is in the database-backed task graph, the owner approval gate, the audit trail, the quality and compliance gates, and the memory of decisions. The SDK provides none of these. Its `ToolLoopAgent` is a single-agent loop, and it would replace the part of the design that is most deliberately controlled.
2. The one part the SDK clearly improves is the model transport: the hand-written OpenAI-compatible HTTP client, its JSON parsing and its output checks. That code is small (93 lines) and well tested, so the gain is maintenance, not a new capability.
3. Nothing in the customer launch uses AI. Adding a dependency now would add risk to the launch build for no launch benefit.

The narrow, reasonable step is listed in section 8.

---

## 2. Current AI architecture (as found)

### 2.1 Layers

| Layer | Files | What it does |
|---|---|---|
| Provider transport | `lib/ai/llm/openai-compatible.ts` (93 lines), `lib/ai/llm/mock-provider.ts` | Hand-written `fetch` to `{baseUrl}/chat/completions`, with an `AbortController` timeout, `response_format: json_object` when JSON is requested, and a retryable flag on HTTP 429 and 5xx. |
| Provider routing and policy | `lib/ai/llm/gateway.ts` (118 lines), `lib/ai/llm/health.ts`, `lib/ai/llm/cost.ts`, `lib/ai/llm/config.ts` | Tries providers in order. Skips disabled providers, paid providers the owner has not approved, providers whose circuit breaker is open, and providers at their daily quota. Retries with backoff. Records usage. Never falls back to a paid provider that was not approved. |
| Provider configuration | `lib/ai/llm/config.ts` | Three tiers: `local-ollama` (default `http://localhost:11434/v1`, model `qwen2.5:0.5b`), `hosted-free`, and `paid` (only with the owner's approval). Keys come from environment variables, which are read on the server only. |
| Agent runtime | `lib/ai/runtime.ts` (103 lines) | Validates input with zod. Calls `assertNoPersonalData`. Builds one system prompt and one user JSON. Makes one gateway call with `jsonMode: true`. Parses the reply with `parseJsonLoose`. Checks it against the agent's zod output schema. |
| Agent registry | `lib/ai/registry.ts` (299 lines) | 16 agents. Each has a mission, boundaries, a prompt version (`1.0.0`), a timeout of 60 s, `maxAttempts` 3, an output schema and a deterministic mock output. |
| Tool permissions | `lib/ai/tools.ts` (25 lines) | Five tool names: `store.readAggregates`, `store.readKnowledge`, `store.saveArtifact`, `store.saveMemory`, `approval.propose`. `assertToolAllowed` checks a grant list. |
| Orchestration | `lib/ai/orchestration/engine.ts` (951 lines), `store.ts` (304), `retry.ts` (17), `graph.ts` (90), `trace.ts` (108) | A task graph stored in Postgres. Tasks are claimed with a lease, retried with exponential backoff (base 2 s, cap 5 min, 3 attempts), and blocked or unblocked by dependencies. Tasks that have been running for more than 15 minutes are returned to the queue, or failed once their attempts are used. Each run has an idempotency key. |
| Workflows | `lib/ai/workflows/templates.ts` (136 lines) | Five templates: marketing, sales, support, visa, analytics. Steps that could have external effects carry an approval class. |
| Policy | `lib/ai/policy.ts`, `lib/ai/types.ts` | `EXECUTE_EXTERNAL_ACTIONS = false`. Six external action classes: publish, send message, payment, production change, deploy, commitment. Each requires an owner decision. |
| Approvals | `lib/ai/approvals.ts` (221 lines) | Owner-only decisions. An agent can never decide an approval. A decision can only be made once. |
| Memory | `lib/ai/memory/` (service 183, store 137, learning 109, briefing 95) | Owner decisions, experiments, results and learning, with append-only history. |
| Quality and compliance | `lib/ai/quality/` (controller 131, checks 124), `lib/ai/review/` | Checks outputs for compliance and factual issues, for example a draft that promises a visa outcome. Owner review queue. |
| Personal-data guard | `lib/ai/security/personal-data.ts` | Blocks names, emails and phone numbers before any model call. |
| CRM (AI) | `lib/ai/crm/` (service 430, rules 237, supabase-store 183) | Leads, stages, follow-ups and stage history in `ai_leads`, `ai_follow_ups` and related tables. |
| Scheduler | `lib/ai/scheduler/`, `app/api/ai/scheduler/*` | Persistent job queue with leases. The HTTP trigger needs `AI_SCHEDULER_SECRET` (returns 503 when unset, 405 for GET). |
| Persistence | 48 `ai_*` tables created in migrations `0002`–`0018`, plus RPCs such as `ai_scheduler_lease` | All state, including tasks, approvals, usage, memory, quality reviews and events. |
| Admin UI | `app/[locale]/admin/command-center/` (25 entries) | Dashboards for agents, approvals, tasks, memory, CRM, campaigns, monitoring and the scheduler. |

### 2.2 How an agent call happens today

1. The engine claims a ready task from Postgres (lease).
2. The runtime checks the input and blocks personal data.
3. The gateway tries providers in order, applying policy, circuit breaker, quota and retry.
4. The reply is parsed as JSON and checked against the agent's zod schema.
5. The result is saved as an artifact, memory, or an approval proposal. The owner decides any approval.

**The model never chooses a tool.** `tools` on an agent definition is a permission list checked by code. No request sent to a model includes a tool definition (search for `tools:` or `toolChoice` in `lib/ai/` finds nothing). This is a deliberate safety property.

### 2.3 Other facts

- No AI SDK package appears in `package.json` or `package-lock.json`.
- No streaming is implemented anywhere. The admin UI does not stream model output.
- Customer pages (`app/[locale]/`, excluding the command center) do not import `lib/ai`. AI is internal only.
- Tests: 64 files in `tests/ai/` with roughly 730 test declarations. `tests/ai/engine.test.ts` alone has 17. Coverage includes the approval rules, retry with backoff, invalid model output, the compliance gate, personal-data blocking, and recovery by a new orchestrator instance.
- The mock provider is off unless `AI_MOCK_ENABLED=true`. It is also refused when `NODE_ENV` is `production`, and whenever a real provider is enabled (`lib/ai/llm/config.ts`, line 48).

---

## 3. Existing agent capabilities

| Capability | Status | Evidence |
|---|---|---|
| Multi-agent task graph with dependencies | Implemented | `engine.ts`, `graph.ts`, test "runs in dependency order" |
| Durable state and resumption by another instance | Implemented | `store.ts`, test "a new orchestrator instance continues a run" |
| Retry with exponential backoff, capped | Implemented (two layers: gateway and orchestrator) | `gateway.ts` `retryBackoffMs`; `retry.ts` |
| Provider fallback with cost and approval gates | Implemented | `gateway.ts` loop |
| Circuit breaker per provider | Implemented | `health.ts`, `CircuitBreaker` |
| Daily quota per provider | Implemented | `gateway.ts`, `ai_usage` |
| Input and output validation | Implemented | `runtime.ts` zod checks |
| Personal-data blocking before model calls | Implemented | `security/personal-data.ts` |
| Owner-only approvals and decision logging | Implemented | `approvals.ts`, `engine.ts` |
| Compliance and factual gates | Implemented | `quality/`, `review/`, `visa validation` in `engine.ts` |
| Memory of decisions and learning | Implemented | `memory/` |
| Handoffs with a hop budget | Implemented | test "a handoff chain stops at the hop budget" |
| Scheduler with leases and watchdog | Implemented | `scheduler/`, `app/api/ai/scheduler/` |
| Mock provider for deterministic tests | Implemented (custom) | `mock-provider.ts` |
| Model-driven tool calling | **Not implemented, by design** | No `tools:` in model requests |
| Streaming output | **Not implemented** | No `streamText` or stream code |
| Standard telemetry (OpenTelemetry) | Not implemented; custom logs and an audit table | `logging.ts`, `audit.ts` |

---

## 4. Missing capabilities

These are real gaps, but **none is needed for the customer launch**, and only some are needed for the back office.

| Gap | Needed? | Why |
|---|---|---|
| Live streaming of model text to the admin UI | Optional | Useful for a "watch the agent write" view. The owner has not asked for it. |
| Maintained adapters for more providers | Optional | Only if the owner adds providers. The custom adapter handles the one protocol in use. |
| Model-driven tool calling | No | Conflicts with the permission model (section 6). |
| Standard telemetry export | Optional | Useful for monitoring, but it must not record personal data (section 6). |
| Typed structured output from the provider (`response_format` with a schema) | Optional | Current approach (JSON mode, then zod) works. It can be improved, not fixed. |

---

## 5. What the Vercel AI SDK provides (verified in source)

| Component | Location in repo | Notes |
|---|---|---|
| `ToolLoopAgent` class | `packages/ai/src/agent/tool-loop-agent.ts` | Runs the model in a loop, executing tool calls until a stop condition. Settings include `model`, `instructions`, `tools`, `stopWhen` (default: at most 20 steps), `output`, `toolApproval`, `prepareStep`, and lifecycle callbacks such as `onStepFinish` and `onToolExecutionStart`. |
| Tool approval | `needsApproval` on a tool, and `toolApproval` on the agent (`generate-text/resolve-tool-approval.ts`) | Pauses a tool call until a decision. Overlaps with, but does not replace, the owner approval engine. |
| `generateText`, `streamText`, `generateObject`, `streamObject` | `packages/ai/src/generate-text`, `stream-text`, `generate-object`, `stream-object` | Core calls. `maxRetries` defaults to 2, with exponential backoff. |
| Structured output | `Output.object`, `Output.array`, `Output.choice`, `Output.json` | Output checked against a schema (zod is a peer). |
| Streaming to UI | `createAgentUIStream`, `createAgentUIStreamResponse`, `toUIMessageStream` | For chat-style interfaces. |
| Stop conditions | `stepCountIs`, `hasToolCall`, `isLoopFinished` | |
| OpenAI-compatible provider | `@ai-sdk/openai-compatible` 3.0.94 | Accepts a custom `baseURL` and a resolvable `apiKey`. Works with Ollama's `/v1` endpoint in principle. Not tested here. |
| Retry rules | `retry-with-exponential-backoff.ts`, `APICallError.isRetryable` | Retries only errors marked retryable. |
| Test helpers | `MockLanguageModelV2/V3/V4`, `mockValues`, `simulateReadableStream` | Deterministic model doubles. |
| React hooks | `@ai-sdk/react` 4.0.183 | Client-side chat state. Not needed for the back office. |
| Durable agents | `@ai-sdk/workflow` 2.0.111, `WorkflowAgent` | Requires a separate `workflow` runtime (peer `workflow` ^5.1.0). Hosting requirements were not verified. |
| AI Gateway | `@ai-sdk/gateway` | Vercel-hosted routing. Not compatible with the $0 constraint without review (section 7). |
| Telemetry | `packages/ai/src/telemetry/` | OpenTelemetry-style events. Records inputs and outputs unless `recordInputs` or `recordOutputs` is set to `false` (see `create-telemetry-dispatcher.ts`). |

The SDK has **no circuit breaker**, **no task graph or database-backed orchestration**, **no approval gate beyond tool approval**, and **no memory or personal-data guard**.

---

## 6. Comparison: existing implementation against the SDK

| Concern | Existing | SDK | Verdict |
|---|---|---|---|
| Provider HTTP transport | Custom, 93 lines | `@ai-sdk/openai-compatible` | **Duplicated.** SDK is maintained and handles more protocol cases. |
| JSON parsing and schema check | `parseJsonLoose` plus zod | `Output.object` plus zod | **Duplicated.** Equivalent. |
| Retry | Gateway and orchestrator, both with backoff | `maxRetries` on each call | **Partly duplicated.** Two retry layers already exist; the SDK would add a third unless one is removed. |
| Circuit breaker | Custom (`health.ts`) | None | **Keep ours.** The SDK has no equivalent. |
| Quota and paid-provider gate | Custom (`gateway.ts`, `config.ts`) | None | **Keep ours.** Core to the cost policy. |
| Mock model | Custom `MockProvider` | `MockLanguageModelV3` | **Duplicated.** Low value to replace. |
| Usage and cost | Custom (`cost.ts`, `ai_usage`) | `result.usage` | **Partly duplicated.** The SDK reports usage; persistence and quota stay ours. |
| Tool execution | Not model-driven. Code calls the store after checking the permission list. | `ToolLoopAgent` lets the model choose and run tools. | **Conflicts.** See below. |
| Approval of external actions | Owner-only, DB-backed, one decision, audited | Tool-level `needsApproval` | **Keep ours.** The SDK's approval does not carry the owner, the audit trail or the action classes. |
| Task graph, leases, recovery | `engine.ts`, `store.ts` | None | **Keep ours.** Not provided by the SDK. |
| Personal-data guard | `assertNoPersonalData` | None | **Keep ours.** Must stay in front of every model call. |
| Compliance and factual gates | `quality/`, `review/` | None | **Keep ours.** Domain-specific. |
| Memory of decisions | `memory/` | None | **Keep ours.** |
| Streaming | None | Yes | **Gap only if the owner asks for live output.** |
| Telemetry | Custom logs and audit table | Yes | **Optional.** Must not record personal data (section 7). |

### The tool-calling conflict

The current design gives agents a fixed permission list and keeps every write in code, checked against the owner's rules. The SDK's `ToolLoopAgent` gives the **model** the choice of tools and runs them in a loop inside one call. Adopting it for the agents would move decisions from code to the model, and would make it harder to show, for each action, who allowed it. It would also bypass the one-task-per-agent-call pattern on which the audit trail, retries and approvals depend.

If the owner later wants tool calling, a safer design is: a model proposes an action as JSON, the existing engine validates it against the permission list, and the owner approves it. That uses the SDK's structured output but not its tool loop.

---

## 7. Compatibility and security

### 7.1 Compatibility

| Item | Finding | Action needed |
|---|---|---|
| Node.js | The SDK requires Node `>=22`. Local runtime is Node 22.23.5. The Vercel build version is not recorded anywhere in the repository. | Confirm the Vercel Node version before adoption. |
| zod | The lockfile pins `zod` 3.25.76. The SDK peer is `^3.25.76 \|\| ^4.1.8`, so the lock already satisfies it. `package.json` declares `^3.24.1`, which would allow older versions. | Raise the declared range to `^3.25.76`. This is not a major upgrade. |
| React | The lockfile pins 19.3.1. `@ai-sdk/react` peers `^19.2.1` and older 19.x, so it is satisfied. | None unless the React bindings are used. |
| Next.js | 15.5.29 in use. The SDK packages have no Next peer. Server routes already run on the Node runtime. | None expected. Not tested. |
| Major versions | The SDK generation read is `ai` 7 with provider spec v4. Adopting it means a major step from anything older. | Pin exact versions and test before any upgrade. |
| Existing tests | `llm-provider.test.ts`, `llm.test.ts` and `local-provider-e2e.test.ts` test the custom transport. | Any transport swap must keep these green. |
| Tool-loop engine | `engine.ts` (951 lines) assumes one model call per task. | A `ToolLoopAgent` migration would rewrite this, which is high risk. |
| Budget ($0) | Direct providers (Ollama, hosted free tier) cost nothing. AI Gateway is a Vercel-hosted service with usage charges. | Do not use AI Gateway unless the owner approves its cost. |
| Durable workflow | `@ai-sdk/workflow` needs its own runtime. Hosting and cost were not verified. | Do not adopt without a separate review. |

### 7.2 Security considerations

| Risk | Current control | Effect of SDK adoption |
|---|---|---|
| API keys leaving the server | Keys read from environment on the server; never logged; gateway records only error class and short message | SDK reads keys from options or the environment on the server. Same control, but keep the rule explicit. |
| Model choosing an external action | `EXECUTE_EXTERNAL_ACTIONS = false`; actions need an owner decision | `ToolLoopAgent` would let a model request tools. **Must not** be used for any tool that can reach an external system. |
| Personal data sent to a model | `assertNoPersonalData` before every call | SDK has no equivalent. The guard must stay in front. |
| Personal data in telemetry | Custom audit does not store prompts | SDK telemetry records inputs and outputs unless disabled. **Disable it** or set `recordInputs` and `recordOutputs` to `false`. |
| Prompt injection through stored knowledge or memory | Input is wrapped in JSON, tools are limited to a grant list | A tool loop lets injected text drive tool calls. Keep tools read-only or approval-gated. |
| Paid providers used without consent | Owner approval flag in `gateway.ts` | SDK has none. Keep the gateway as the single entry point. |
| Unbounded loops | Hop budget for handoffs, retry caps, stale-run recovery | `ToolLoopAgent` default is 20 steps. Set `stopWhen` explicitly if used. |
| Supply chain | Current code has no AI dependencies | Adding about a dozen transitive packages increases review burden. Pin versions and review the lock diff. |

---

## 8. Recommended AI SDK components

Only one component is recommended, and only later:

1. **`@ai-sdk/openai-compatible`**, behind the existing `LLMProvider` interface, replacing the HTTP code in `lib/ai/llm/openai-compatible.ts`. Keep `gateway.ts`, `health.ts`, `cost.ts`, `config.ts`, the quota and the paid-provider gate exactly as they are. Keep the mock provider.

Components **not** recommended:

| Component | Reason |
|---|---|
| `ToolLoopAgent` | Moves tool choice to the model. Conflicts with the permission model and the approval design (section 6). |
| `@ai-sdk/workflow` | Needs a separate runtime. Duplicates the existing engine, leases and recovery. |
| `@ai-sdk/gateway` (AI Gateway) | Vercel-hosted, with usage charges. Conflicts with the $0 constraint. |
| `@ai-sdk/react` | No chat UI is planned for the back office. |
| SDK telemetry | Records personal data unless configured. Adds little over the audit table. |
| `streamText` | No streaming requirement exists. Add only if the owner asks. |

---

## 9. Estimated implementation complexity

These are judgement-based estimates. They were not measured by building anything.

| Option | Scope | Complexity | Rough effort | Main risk |
|---|---|---|---|---|
| A. Adopt the SDK transport (section 8) | One provider file, one dependency, three test files | Low to medium | 1 to 3 days of work, including tests | Behaviour differences in error mapping; keep the error classes the gateway relies on |
| B. Use SDK structured output in place of `parseJsonLoose` | `runtime.ts` and the output checks | Low | Under 1 day | Small; zod checks must stay |
| C. Replace the custom mock with SDK test models | Test helpers | Low | Under 1 day | Low value |
| D. Migrate agents to `ToolLoopAgent` | `runtime.ts`, `engine.ts`, 16 agents, approvals, tests | High | Weeks, not days | Breaks the audit and approval model. **Not recommended.** |
| E. Adopt `@ai-sdk/workflow` | Scheduler and orchestrator | High | Weeks, plus hosting review | Second orchestration system beside the existing one |

---

## 10. Expected benefits

From option A (the only recommendation):
- Less custom HTTP and protocol code to maintain: about 90 lines in one file.
- Upstream fixes for the OpenAI-compatible protocol, instead of our own.
- An easier path to add a provider later, if the owner ever needs one.

Not expected, because the gap does not exist in the current design:
- Better safety or governance. The SDK's approval and tool loop do not provide the owner-level controls the application already has.
- Better orchestration. The task graph is the core asset and is not replaced.
- Streaming, unless the owner asks for live output.

---

## 11. Features that must remain unchanged

- Owner-only approvals, with one decision per approval and the owner's identity recorded.
- `EXECUTE_EXTERNAL_ACTIONS = false` and the six external action classes.
- The database-backed task graph, leases, retries and stale-run recovery.
- `assertNoPersonalData` before every model call.
- Paid providers blocked unless the owner approves them.
- The mock provider never runs beside a real provider.
- Quality, compliance and factual gates.
- The audit trail and append-only history of decisions.
- Customer-facing pages do not use AI. The back office stays internal, deferred and off the launch build.
- $0 budget. No AI Gateway, no paid services.
- No model receives tool definitions unless a separate, reviewed design approves it.

---

## 12. Open questions for the owner

1. Will the AI back office be activated? If not, no SDK work is needed.
2. Is live streaming in the admin UI wanted? If yes, `streamText` becomes relevant.
3. Which Vercel Node version does production use? (The SDK needs Node 22 or newer.)
4. Is the owner willing to accept a new dependency tree, with the review it needs?

---

## 13. Verification performed for this audit

- Read the application's AI code: `lib/ai/llm/*`, `runtime.ts`, `registry.ts`, `tools.ts`, `orchestration/engine.ts`, `orchestration/retry.ts`, `policy.ts`, `workflows/templates.ts` (line counts and key functions).
- Confirmed by search: no AI SDK package in `package.json` or the lockfile; no `tools:` or `toolChoice` in model requests; no streaming code; no customer page imports `lib/ai`.
- Read the SDK source at commit `d55f3cf`: `ToolLoopAgent` and its settings, `needsApproval`, `Output`, streaming functions, retry logic, telemetry defaults, provider packages and peer ranges.
- Checked peer ranges against the lockfile: `zod` 3.25.76 and `react` 19.3.1 satisfy them.
- Not done: no install, no build with the SDK, no test run against a live model, no measurement of latency or cost.

## 14. Files created by this audit

- `globaltravelassi/docs/audits/GLOBALTRAVELASSI_VERCEL_AI_SDK_AUDIT.md` (this file). Untracked. Not committed.
- `/home/user/vercel/ai` (read-only shallow clone, outside the project). It can be deleted at any time.
