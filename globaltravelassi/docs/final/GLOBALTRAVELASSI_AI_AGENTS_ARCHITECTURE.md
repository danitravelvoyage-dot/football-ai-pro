# GLOBALTRAVELASSI: AI agents architecture

Date: 22 November 2026. Scope: what exists, what was tested in this pass, and what is blocked. The AI back office is **deferred**: its code and tests pass, but its migrations (`0002`–`0018`) are applied nowhere, so it does not run in production.

## Vercel AI SDK decision: PARTIAL_ADOPTION, deferred. Nothing adopted in this pass.

The audit is in `docs/audits/GLOBALTRAVELASSI_VERCEL_AI_SDK_AUDIT.md`. In short:

| Criterion | Finding |
|---|---|
| Architecture compatibility | The SDK's `ToolLoopAgent` lets the model choose and run tools. This app deliberately gives models no tools: code checks a permission list and the owner approves external actions. Adopting the loop would weaken that. |
| Measurable benefit | Replacing the 93-line OpenAI-compatible client with `@ai-sdk/openai-compatible` saves maintenance only. No new capability is needed for the launch. |
| Maintainability | A new dependency tree, versus about 90 lines that are already tested |
| Security | The SDK has no personal-data guard, no owner approval and no circuit breaker. Its telemetry records prompts unless disabled. |
| Operational cost | Direct providers cost nothing. The SDK's AI Gateway is a paid-capable hosted service. |

Rule applied: implement only verified beneficial components. None qualified for this pass. The one candidate, the transport, is for when the back office is activated.

## Engine (existing, unchanged in this pass)

| Requirement | Status | Where |
|---|---|---|
| Explicit agent registry | Yes: 16 agents | `lib/ai/registry.ts` |
| Dedicated instructions | Yes: mission, boundaries, versioned prompt per agent | `lib/ai/registry.ts` |
| Typed tool schemas | **No, by design.** Tools are a permission list checked in code; models never receive tool definitions. | `lib/ai/tools.ts` |
| Validated inputs, structured outputs | Yes: zod input and output contracts | `lib/ai/runtime.ts` |
| Server-side execution | Yes: Node runtime only | `lib/ai/*`, `app/api/ai/scheduler/*` |
| Provider abstraction | Yes: local, free hosted and paid tiers; paid only with owner approval | `lib/ai/llm/*` |
| Bounded loops, timeouts, retry limits | Yes: hop budget, 60 s agent timeout, 3 attempts, capped backoff | `lib/ai/orchestration/*` |
| Error recovery, task persistence | Yes: tasks in Postgres with leases; stale tasks re-queued | `lib/ai/orchestration/engine.ts` |
| Execution history, trace | Yes | `lib/ai/orchestration/trace.ts`, audit tables |
| Authorization boundaries, human approval | Yes: owner-only decisions; `EXECUTE_EXTERNAL_ACTIONS = false` | `lib/ai/approvals.ts`, `lib/ai/policy.ts` |
| Orchestration (routing, handoffs, state machine, dependencies, cancellation, idempotency) | Yes | `lib/ai/orchestration/*`, `lib/ai/collaboration/*` |
| Memory (task, knowledge versioning, audit) | Yes | `lib/ai/memory/*`, `lib/ai/knowledge/*` |
| Persistent customer conversation memory | **No.** There is no customer chat, and agents never receive personal data. | n/a |
| Retention and deletion controls for memory | **No.** Records are append-only; retention periods are an open owner decision. | `docs/PRIVACY_AND_COOKIES.md` |

Covered by `tests/ai/`: 61 files, 791 tests, all passing (`npx vitest run tests/ai`, this pass).

## Requested agents

| Requested | What exists | Real tested capability | Blocker |
|---|---|---|---|
| `visa_research` | `VisaResearchAgent`, with an owner-approved source allowlist and knowledge versioning | Engine tests: passes only when every source is on the allowlist. Live local model: a research reply was **refused** for missing `sources`. | A stronger model is needed for usable research output. The back office is not deployed. |
| `visa_analysis` | **New in this pass:** rule-based document-gap analysis per service, on real requests (`lib/crm/insights.ts`) | 13 unit tests; admin and customer browser checks. No model; no outcome guarantees. | None for the rules. An LLM-based profile analysis is not implemented. |
| `travel_planning` | **Not implemented** | None | Needs an agent, an `ai_agents` seed migration and a stronger model. Not built, to avoid presenting an untested capability. |
| `customer_support` | `CustomerSupportAgent`: approved knowledge only; any message to a customer needs owner approval (`external_send_message`) | Engine and approval tests. Not customer-facing: there is no chatbot on the site. | Back office not deployed; stronger model needed |
| `lead_qualification` | **New in this pass:** rule-based qualification on real requests. Also `CRMAgent` and `SalesAgent` in the deferred AI CRM, which uses separate `ai_leads` tables. | 13 unit tests plus browser checks on the real request data path | The AI CRM is not linked to customer requests (recovery finding). The rule-based version is. |
| `marketing` | `MarketingStrategistAgent`, `ContentCreatorAgent`, `SocialMediaAgent`, `VideoProductionAgent`, `CreativeDirectorAgent`; publishing needs owner approval | Engine, campaign and content-review tests | Performance-based recommendations need real campaign data. Back office not deployed. |

## Live model results (this pass)

`qwen2.5:0.5b` on Ollama, on this machine, 3 of 3 tests in two runs:
- The real adapter, gateway and runtime work end to end.
- A research reply that broke its contract was refused, with nothing invented or stored.
- The two-reviewer gate passed for an agent question.
- A lead-stage answer comes from the stored record, not from the model.

## Rules observed

- No fake agent capabilities, research results or visa claims.
- No unauthorized external actions.
- No automatic WhatsApp messages.
- No paid model used.
