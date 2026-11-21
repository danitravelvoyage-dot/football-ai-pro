# GLOBALTRAVELASSI: project status and audit

Status date: 2026-11-21 (session 12). Branch: `feature/ai-marketing-command-center`. Local only. Nothing has been pushed or deployed.
No migration has been applied to any database (0002 to 0017 are all unapplied). The whole chain was applied to a disposable PGlite database in session 10, and nothing else.

## Verification (session 12, AI quality and fact validation)

| Check | Result |
| --- | --- |
| `npm run lint` | passes, no warnings |
| `npm run typecheck` | passes |
| `npm test` (vitest) | 71 files, 919 passing and 3 skipped (the opt-in live model tests), all passing (877 at session 11, 870 at session 10, 838 at session 9, 778 at session 8, 741 at session 7, 728 at session 6, 669 at session 5, 616 at session 4) |
| Browser (`npm run test:browser`, Chromium, production build) | 22 of 22 checks pass: trigger refusals; public home in en, fr and ar with correct direction and no errors; all 28 admin pages redirect to sign-in in en, fr and ar (84 redirects); sign-in, register and forgot forms render in all three locales; no horizontal scroll at 375 px |
| `npm run verify` | passes: lint, typecheck, unit and integration tests, production build (includes `/[locale]/admin/command-center/conflicts`) |
| Browser smoke (`npm run test:browser`, Chromium on the production build) | 13 of 13 checks pass: trigger refusals, public pages in en/fr/ar with correct direction and no page errors, sign-in redirect for private pages, no horizontal scroll at 375 px |
| `npm run build` | passes; `/api/ai/scheduler`, `/[locale]/admin/command-center/scheduler` and `/[locale]/admin/command-center/crm` compile |
| Live probe of the trigger on a production server | 401 with no or wrong bearer, 503 `not_configured` with the correct bearer and no worker credentials, 405 on GET, login redirect for the admin page when signed out |
| SQL tests (PGlite, real Postgres engine) | 21 scheduler tests, including RLS, timezone guard, lease reclaim, fencing, dead letters and TRUNCATE refusal; 17 CRM tests covering the stage guard, database-written history, append-only records, application-link rule, one open follow-up per lead, and operator, ordinary-user and anonymous isolation |

Not verified: a live database with migrations 0002 to 0011 applied; two real database connections racing for a lease; an authenticated browser run of the scheduler page; a live AI provider.

## Session 2 additions (business intelligence and notifications)

Built and tested:

1. **Business memory reaches agents.** `lib/ai/memory/briefing.ts` builds a read-only briefing: rejected and retired strategies, strategies not reviewed for 90 days, and learning that passed the evidence gate. `MemoryService.briefing()` accepts only the owner or the platform; an agent is refused. The engine attaches the briefing to each agent task (`context` key `owner.decisions` and `learning.evidence`). Agents never query the memory store. The company profile already reached agents through team-visible shared context.
2. **Quality feedback reaches the retry.** If the latest review asked for a revision, the next attempt receives its locations and instructions (`revision` / `quality.feedback`). Once a later review passes or rejects, old feedback is no longer sent. Feedback never includes the reviewed text.
3. **Agent performance history (data).** `performanceHistory()` gives runs per agent per day. Days without runs are omitted, not shown as zero. No UI yet.
4. **Owner notifications.** Inbox with dedupe keys (one row per notice), personal-data refusal, owner-only read and mark-read, migration 0012 (not applied) with a read-once guard trigger. Notices come from terminal task failures (critical), overdue scheduled work (warning, once a day), and a daily agent summary (info or warning, once a day).
5. **Scheduler and notifications.** A missing worker cannot notify from inside the scheduler. It shows on the pages, but no notice is sent yet. An independent check is required.

Not built in this session: the inbox page, the scheduled owner report, scheduler-health notices from an independent check, campaign management, content review and approval dashboard, knowledge base admin forms, the marketing command center redesign, and the performance history chart.

## Session 3 additions (notifications complete, campaigns, content review, knowledge admin, unified view)

**Phase 2 (complete).** Inbox page with severity, type and unread filters, unread count, and owner-only mark-as-read (read-once). An independent watchdog endpoint raises a critical notice when the scheduler has not run. A daily owner report is written after each scheduler run. Trigger authentication is shared by the scheduler and the watchdog.

**Phase 3 (campaigns, core).** Create, edit (name, goal, channel, dates; objective, KPIs and budget are fixed at creation), status lifecycle (draft to active, active to paused or finished, paused to active or finished), archive (not while active; hidden by default). Objectives only accept KPIs they measure. Agents and content are assigned. Launch needs at least one agent and every assigned content item approved. Spend is refused beyond the budget and before launch. KPI readings are owner-entered and never estimated. Every change is written to a campaign history table. Campaign execution outside the platform (ad accounts, publishing) is not connected.

**Phase 4 (content review, core).** Content inbox showing each item, its latest quality review and its recent decisions. Approve, reject (reason required) and request revision (note required). A revision note is sent to the writing agent as team-visible context, versioned, and reaches the agent's next run. Approval does not publish: publishing still goes through the approval engine per task.

**Phase 5 (knowledge base admin).** Owner search across title, body and tags, with category, country, language, reliability and tag filters. Tags (up to ten, lowercase). Create and edit through the existing save rule (same category, slug, language and country replaces content). Archive is the existing retire action; no hard delete. Version history is written by a database trigger on every content change. The trigger runs as its own definer, which was needed: without it the write was blocked by row-level security (found by test, fixed).

**Phase 6 (unified view, partial).** The command center overview now shows real counts from each module (active campaigns, content awaiting review, unread notices, scheduler status, knowledge entries; unavailable shown as such) and links to every module. The existing executive, agent, task, approval, monitoring and memory pages are unchanged. There is no dedicated analytics or report page yet.

**Not built in this session:** an automated test of the Supabase stores for campaigns, content review, notifications and knowledge versions (they are type-checked and their SQL is tested, but no store-level test exists); a rendered browser check of the new pages; campaign integration with external ad platforms; knowledge retrieval by tag for agents; a dedicated analytics and report page.

## Session 4 additions (provider reliability, knowledge retrieval, analytics, execution trace)

**AI provider (P0), partial.** Built and tested:
- Adapter tests over real HTTP against a local test server. The replies in those tests are protocol fixtures, not model output, and the application never uses them.
- Rate limits and server errors are retryable; rejected requests are not. A timeout is retryable. A reply that is not JSON is a non-retryable provider error. Error messages never contain the secret.
- Retries on the same provider with backoff (500 ms, 1 s, 2 s, capped at 8 s), per provider, configured with `AI_*_MAX_RETRIES`.
- A circuit breaker per provider: opens after three consecutive failures, for 60 seconds. Health snapshot: calls, failures, last error class, open-until time. In-process only: it is not shared between server instances.
- Token usage per provider and day. Cost from an owner-entered price list (`AI_*_PRICE_IN_PER_1K` and `AI_*_PRICE_OUT_PER_1K`). With no price the cost is null. The platform never estimates a price.
- Secrets: the configuration holds only the name of a secret variable. A test checks that the value never appears in the configuration.

**Not done for the provider, and why:**
- **Real model execution has not been run.** No hosted key has been provided, and no local model is installed in this environment. Provider calls have been tested only against the local test server.
- Model selection is one configured model per provider. There is no per-agent model choice.
- Health is not yet on the owner dashboard.
- Usage counters are read then written, so concurrent requests can undercount the daily quota. Quota enforcement is approximate under concurrency (finding S1 below).

**Knowledge intelligence (P1), built.** Retrieval is still gated by the existing rules (current, language, country, category, verified only). Within that gate:
- Tag filter: only entries that share a tag with the request are returned.
- Relevance ranking: a score from matching objective terms (any script), tags, reliability, country specificity and freshness. Each result carries the reasons for its score.
- Country and language context. Reliability: verified official ranks above verified internal.
- Version awareness: the agent receives the current version. Editing an entry resets it to unverified until the owner verifies it again.
- Retrieval audit: every retrieval writes an audit row with entry identifiers, versions and scores. It never writes the entry text.

**Analytics engine (P1), built.** Pure functions over stored rows, with daily, weekly and monthly periods:
- Approval conversion. Only the owner's own decisions count; expired items do not.
- Content performance per kind.
- Agent performance per period: volume, failure rate and average duration.
- Lead conversion, using applications as leads. Revenue, counting only payments marked received.
- Model cost, with the total withheld while any provider or usage day is unpriced.
- Analytics page for the owner, with a notice when cost data is incomplete.

**Multi-agent (P1), partial.** Execution trace for one run: steps in order, dependencies, attempts, latest quality status, steps waiting on unfinished dependencies, and cross-agent conflicts. The trace contains identifiers and codes only.

**Not built in this session:**
- Agent-to-agent delegation, specialist review and quality consensus. These need a new protocol and are not started.
- Lead pipeline, lead scoring, customer history, follow-up automation and campaign attribution. There is no lead table; the analytics currently use applications as the only lead source.
- Competitor intelligence (P2). Public-source monitoring needs an approved list of sources and a fetch design. Not started.
- Autonomous CEO (P2). Not started.

**Migration 0014 (not applied):** input and output token columns on `ai_usage`. Days recorded before it are unpriced, not estimated.

**Security findings (this session):**
- S1. Usage counters are read then written. Concurrent requests can undercount the daily quota, so quota enforcement is approximate. Fix: an atomic upsert function. Not built.
- S2. The provider circuit breaker is per process. Several instances will each trip separately.
- S3. The `ai_campaigns` policy from migration 0002 still lets the operator write campaigns (`ai_campaigns_rw`). Migration 0013 tightens the new campaign tables but not that policy. Needs a decision.
- S4. The execution trace and retrieval audit contain identifiers and scores only. A test checks that entry text does not reach the audit.
- S5. Secrets: no secret value appears in provider configuration or in adapter error text. Tested against a server that echoes the key.

## Architecture (summary)

- **Composition root** (`lib/ai/services.ts`): `buildAiServices(db)` builds every service on one database session. The admin uses the cookie session; the scheduler uses its operator session.
- **Orchestrator** (`lib/ai/orchestration/engine.ts`): a tick expires approvals, recovers stale running tasks, updates readiness, runs due tasks through the quality gate, and dispatches events. The tick report now includes expired approvals, recovered tasks, overdue tasks and event counts.
- **Scheduler** (`lib/ai/scheduler/`): a persistent queue with leases, fencing, retries, dead letters, heartbeats and owner-only settings. One pass runs one orchestration cycle per leased job. See `SCHEDULER.md`.
- **Approvals** (`lib/ai/approvals.ts`), **event bus** (`lib/ai/events/`), **shared context** (`lib/ai/context/`), **knowledge base** (`lib/ai/knowledge/`), **quality controller** (`lib/ai/quality/`), **business memory** (`lib/ai/memory/`), **observability** (`lib/ai/observability/`): unchanged in this change except as noted.
- **Trigger** (`app/api/ai/scheduler/route.ts`): an authenticated POST endpoint. The middleware exempts exactly this path from the locale redirect; the route checks the secret itself.
- **Worker** (`lib/ai/scheduler/worker.ts`): signs in as a dedicated operator account with the anon key. No service-role key is used anywhere in the repository (checked by search).

## Completed in this change

1. Persistent job queue with leases, `for update skip locked`, lapsed-lease reclaim, fenced completion and failure, dead letters after the attempt limit (migration 0011, not applied).
2. Scheduled execution in UTC epoch slots, with duplicate prevention through a unique slot key.
3. Automatic retries with backoff (1 to 15 minutes).
4. Crash recovery for both jobs (lapsed leases) and tasks (stale `running` tasks).
5. Approval expiry sweeping, event dispatch and overdue detection inside the cycle.
6. Worker heartbeats and health status: disabled, no recent worker, overdue work, healthy.
7. Owner-controlled settings with validation, owner-only writes and an audit trail of changed fields.
8. Monitoring: the scheduler figures on the monitor replace the former hard-coded "not built" status. Unavailable figures show as unavailable.
9. Admin page: `/[locale]/admin/command-center/scheduler`, in Arabic, French and English, responsive.
10. Documentation: `SCHEDULER.md`, `.env.example` entries (names and placeholders only).

## Modified files

- New: `lib/ai/scheduler/{schedule,store,supabase-store,service,worker,load}.ts`, `lib/actions/scheduler.ts`, `app/api/ai/scheduler/route.ts`, `app/[locale]/admin/command-center/scheduler/page.tsx`, `supabase/migrations/0011_scheduler.sql`, `SCHEDULER.md`, `PROJECT_STATUS.md`.
- Changed: `lib/ai/orchestration/engine.ts` (recovery, overdue, dispatch counts), `lib/ai/services.ts` (`buildAiServices`, scheduler wiring), `lib/ai/observability/{metrics,load}.ts`, `middleware.ts` (one exact exemption), `app/[locale]/admin/command-center/layout.tsx` (nav item), `lib/i18n/{en,fr,ar}.ts` (new block), `.env.example`.
- Tests: new `tests/ai/scheduler.test.ts`, `tests/ai/scheduler-route.test.ts`, `tests/ai/middleware-scheduler.test.ts`, `tests/db/scheduler.test.ts`; updated `tests/ai/observability.test.ts` (scheduler figures instead of "not built") and `tests/db/migration-validation.test.ts` (history now runs to 0011).

## Integration report

- Scheduler to orchestrator: the cycle calls `tick()`, so approvals, recovery, readiness, task execution and dispatch all run from the scheduler.
- Scheduler to event bus: dispatch counts appear in each cycle report and in the audit trail.
- Scheduler to approvals: expiry runs inside every tick; the expiry itself is still enforced by the approval service and the database.
- Scheduler to observability: health and dead-letter figures are read from the same rows the scheduler writes.
- Scheduler to authorization: the operator account is subject to the same RLS as every other AI table; settings are writable only by administrators.

## Security audit

Findings and status:

1. **Migrations 0002 to 0011 are not applied.** All database security findings below are verified only on PGlite. Priority: high, blocked by owner approval.
2. **Migration 0010 (append-only hardening) is not applied.** It blocks TRUNCATE on the audit and history tables and adds a row trigger to `ai_events`. Priority: high.
3. **TRUNCATE on the original customer tables (migration 0001) has not been reviewed.** Priority: medium. Needs a decision by the owner.
4. **Scheduler: TRUNCATE is revoked** on its three tables (verified). Scheduler writes go only through functions; direct writes are refused (verified).
5. **Scheduler: the trigger is authenticated** with a constant-time comparison of digests and no default secret (verified by unit tests and a live probe).
6. **Scheduler: error text stored in `last_error`** is limited to 200 characters but may include database text. Priority: low. Visible only to administrators and the operator.
7. **Scheduler: the operator account** can read and run the AI tables it already had access to. It cannot decide approvals, change settings or write heartbeats or jobs directly. Its password lives only in the host's environment.
8. **Middleware exemption** covers one exact path. Tests check that a path that merely starts with it is still redirected.
9. **No service-role key** appears anywhere in the repository (searched).
10. **Form pending state** and redirect behaviour were verified in an earlier session; not re-tested here.

## Session 5 additions (CRM and sales pipeline)

**Built and tested (migration 0015, not applied):**
- **Leads:** `ai_leads` with source tracking (application, manual, campaign, referral, social). An application lead must point to its application; any other lead must not. Contact details are never copied into the CRM: they stay in the application record.
- **Pipeline:** stages new, contacted, qualified, interested, converted, lost. Allowed moves are defined once in `lib/ai/crm/rules.ts` and repeated in the database guard, so a direct client update cannot skip them. A lost lead needs a reason. A converted lead is terminal. A lost lead can be reopened to new.
- **Stage history:** written by the database itself, in the same transaction as the stage change, so a refused move leaves no history row. The history table is append-only.
- **Interaction history:** notes, calls, meetings, messages the owner sent outside the platform, and status updates. Append-only.
- **Scoring:** rule-based and deterministic. Each point carries a reason code, which the page shows. Reasons cover source, known destination, travel within 90 days, stage, purchase intent, recent activity and dormancy (30 days without activity). Scores are computed on read, not stored, so they cannot go stale.
- **Purchase intent:** keyword rules in English, French and Arabic applied to the owner's own notes. The result is a level only (high, medium, none). The matched text is never returned. It is a heuristic, not a model judgement.
- **Follow-ups:** the rules suggest one follow-up per quiet lead, with a priority. A suggestion waits for the owner: approve schedules it, dismiss closes it, complete records it. Nothing is sent to a customer. The database allows one open follow-up per lead. Closing a lead dismisses its open follow-ups.
- **Sales funnel:** how many leads have ever reached each stage, from stored history. Rates are null when there are no leads, never zero.
- **Authorization:** every CRM action is owner-only. Agents and the system are refused. Personal-data text (emails, phone numbers) is refused in labels, summaries and reasons.
- **Isolation:** administrators only. The operator account, ordinary signed-in users and anonymous visitors see no leads, history, interactions or follow-ups.
- **Owner page** at `/admin/command-center/crm`: funnel, filterable lead list, create form, lead detail with reasons, stage moves, interactions, history, and follow-up decisions. Translated in Arabic, French and English.

**Not built, and why:**
- **AI enrichment of leads:** the directive asks for it to be configurable. It is not built: no model key is available, and the shared gateway has not been connected to CRM tasks. Scoring is rules only today.
- **Command-center overview and analytics page:** the funnel is shown on the CRM page only. It is not yet on the overview or the analytics page.
- **Store-level tests for the Supabase CRM store:** the store's SQL is covered by the PGlite tests, but its TypeScript paths are only type-checked.
- **Stage change and history write in one application call:** the database trigger makes them atomic. The memory store mirrors this, but the trigger itself is tested on PGlite only.
- **Rendered browser check of the CRM page:** not done.

## Session 12 additions (AI quality and fact validation)

**Principle.** Factual validation is separate from the two reviewers. It checks sources against the owner's approved list, CRM stages against the CRM's own list and the stored record, and claims against the owner's memory. Its verdict is the last word: the gate's final status is never less severe than the facts, and no combination of votes overrides a fabricated or uncertain fact. It never fetches a URL, so nothing outside the platform is contacted.

**Verified defects, found before changing anything.**
- A research finding with a well-formed but unapproved URL passed as verified.
- A finding with low confidence and no source was accepted as "uncertain" and stored.
- The research placeholder stored a finding titled "Mock finding." with the evidence "Mock evidence." and no source.
- The CRM agent's output had no stage field, so no suggested stage was validated against the CRM.
- A free-text answer was delivered on the reviewers' approval alone, with no source.

**Implemented.**
1. **Factual validation** (`lib/ai/factual/validate.ts`, pure). Source checks: invalid or insecure URLs, credentials, non-default ports, private or internal hosts are fabricated and refused; a public https address the owner has not approved is uncertain and goes to the owner. Research findings need a source, and missing evidence asks for revision, then refuses. Stages must be one the CRM defines and must match the stored record. Claims with values are compared with the owner's memory. Free-text answers are delivered only when they cite approved sources.
2. **Gate.** Factual verdicts are combined last, so they cannot be outvoted. Test: two approving reviewers do not make a fabricated fact pass.
3. **Engine.** Research sources and memory contradictions are checked before the gate. Each non-verified outcome is audited with codes only.
4. **CRM stages.** The CRM agent's proposal schema accepts only the CRM's own stages. The stage answer (`lib/ai/factual/stage-answer.ts`) is always the stored record. The model is a cross-check, given only the question and the allowed list. It is refused if it names an invented stage, and escalated if it names a different real stage.
5. **Answers.** Free-text answers carry a `sources` list. Without approved sources they are held for the owner, not delivered. Fabricated sources are refused.
6. **Research placeholder** is now an empty findings list, which claims nothing.

**Reproduction of the defect.** A scripted model answering "Boundaries" for "Which stage should a new family visa enquiry start in?" is refused, and the answer is the stored stage "new". A test pins this.

**Real local model (qwen2.5:0.5b).** The stage check agreed with the stored record, so the answer is "new" with status answered (live, one run). The live run did not produce an invented stage, so the refusal path is proven only by the scripted reproduction.

**Tests.** Factual validation: 21 unit tests (fabricated URLs, unsupported claims, missing evidence, contradictory memory, valid sources, CRM stage cases, verdict combination). Gate: 5 new tests for the factual last word. Stage answers: 7 tests. Engine: 6 factual integration tests. Exchanges: updated to the source-backed contract, with new cases for held and fabricated answers.

**Remaining risks and gaps.**
- Source checks cover form and the owner's approved list, not content. A real approved page can still be wrong. The platform does not read pages.
- The approved host list is empty by default, so research with sources will be escalated until the owner approves hosts.
- Memory contradictions are checked only for claims with values (visa requirements). Research findings have no value, so memory cannot contradict them.
- Free-text answers that are held, and stage disagreements that are escalated, are recorded in the audit log only. An owner screen for them is not built.
- Factual validation cannot judge whether an answer is correct. The stage answer is correct because the record is used, not because the model is trusted.
- The 0.5B model does not meet the research contract, so research findings are refused in practice. A larger model needs owner approval.
- Cross-agent conflicts remain unreachable (see the pinned test).
- Stage proposals in CRM output are validated for the stage name only. Whether a proposed move is allowed for a specific lead is not checked.

## Session 11 additions (local AI activation)

**Result: a real local model runs, and one agent question is answered by it. The research agent's full contract is not met by the 0.5B model.**

**Environment and installation (owner-approved).**
- Egress policy first refused `ollama.com` and `huggingface.co` (403). The owner approved a personal environment, "football-ai-pro (local AI download)", allowing `ollama.com` and `registry.ollama.ai`.
- Ollama 0.40.17 installed with the official script, after `zstd` was installed as its prerequisite (both approved).
- The Ollama server runs in the background in this container (no systemd). Model `qwen2.5:0.5b` pulled: 397 MB, Q4_K_M, context 32768.

**Real inference results (measured, not estimated).**
- Agent question, CRM agent, through the real gateway and adapter: delivered, approved by both reviewers, in 543 to 1,002 ms. The answer was `"The new family visa enquiry should start in the 'Boundaries' stage."`. The stage is wrong. The gate checks structure, policy and claims, not whether an answer is correct.
- Research agent, MarketResearchAgent: refused by the output contract on every run, with `sources` containing text that is not a URL. The refusal is the correct behaviour: no output is stored. Token usage reported by the server: 136 in, 178 to 219 out. Time to refusal: about 1.7 to 2.4 s.
- Raw JSON-mode check outside the platform: a single answer-shaped object was returned correctly in three of three requests, using about 7 output tokens.

**Defects fixed.**
1. The mock provider could answer in place of a real model when both were enabled (see the earlier entry in this section).
2. Agent requests did not ask the endpoint for JSON. Agent requests now set `response_format: json_object`, so the endpoint is asked for one JSON object. Plain requests are unchanged. Tested.
3. The agent-question request put the question inside the input object, where the model echoed the input back instead of answering. The question is now the task, and the answer contract is short and explicit. The agent's own boundaries are unchanged. Tested.

**Verified without a model.** Invalid and empty replies are rejected. A down local model produces no output, even with the mock flag on. A hosted-provider key never reaches the local endpoint. The live-test wrapper fails if anything other than a validated output or a recorded contract refusal occurs.

**Open decisions and blockers.**
- The 0.5B model cannot meet the research contract. A larger model (for example `qwen2.5:1.5b`, about 1 GB) needs owner approval before download. It is not downloaded.
- Answer quality is not checked by the gate. A delivered answer can be wrong, as the stage answer shows.
- The live tests are opt-in (`LOCAL_AI_LIVE=1 npm run test:local-model`). They are skipped in `npm run verify`.
- Local AI remains off by default. It is enabled only by setting `AI_LOCAL_ENABLED=true`.

## Session 10 additions (CEO readiness audit)

Scope: the eight objectives in the audit brief, run at $0. No paid API, no real model call, no real message or publication, no production migration, no deployment, no push.

**Verified (with evidence).**
- **Migration chain 0001 to 0017** applied in order on one disposable PGlite database with the seed: every expected table exists, row-level security is enabled on every AI table, the stage, conflict and append-only guards are installed, and no migration drops a table or deletes customer rows. This is PGlite with Supabase stubs, not a live Postgres.
- **All five business workflows** run end to end through the real engine on the mock: marketing, sales (with its CRM lead step), customer support, visa, and analytics. Each completes its internal steps. Each external step (publish, customer message) stops at an owner approval, and approval only issues an owner card, marked as not executed by the platform.
- **Approval and escalation paths**: owner approval releases the step, owner rejection blocks it, compliance outputs always wait for the owner, a blocking compliance violation is rejected, and expiry cancels the waiting task.
- **Outbound requests** (regression guard): only three modules make network requests (the owner-configured model adapter, and the competitor reader, which uses GET only). No messaging, email or payment client is referenced, and no such package is a dependency. The guard fails the build if a new outbound call appears.
- **Free local provider path**, end to end against a local stub server: configuration, the OpenAI-compatible adapter, the gateway and an agent run. Disabled by default. Output is returned only after it passes the agent's contract. A persistent server error fails the run with no fabricated output. A non-JSON reply is refused without retry.
- **Browser**: all 28 admin pages, in all three locales, redirect a signed-out visitor to sign-in. The sign-in, register and forgot forms render.

**Defects found and fixed.**
1. **Question limit could be bypassed for an older run.** The count read the newest 500 question events across all runs and filtered them by run afterwards, so an old run could show zero questions. The store now filters by run, so the count is exact. A regression test fails on the old code and passes on the fix (checked).
2. **Missing token counts were recorded as zero.** When an endpoint omits usage, spend was silently under-counted. The count is now estimated from text length, and the code says so. Prices are still never estimated.
3. **An approved external action was stored as `executed`.** The field records that the owner card was issued, and the platform never performs the action. The store now says so in a comment. No status value or owner-visible label changed. The behaviour was already correct.

**Not verified, and why.**
- **Conflicts raised by the real engine (objective 1): not reachable.** Only the research and visa output kinds produce claims, and each has one agent. Research claims carry no comparable value. Two agents can therefore never disagree on a claim. A pinned test records this. Fixing it means giving outputs a subject and a value, which changes agent output contracts, so it is an owner design decision, not a defect fix.
- **Admin page content and every admin control (objective 2):** not verified in a browser. The check proves access control only. Viewing and acting on pages needs a signed-in owner and a live database.
- **Real model calls (objective 4):** not run. No model key exists, and no local model server or Ollama binary is installed here. The adapter was tested against a stub only.
- **Live migrations and live RLS (objective 3):** not verified. PGlite does not model Supabase's auth roles exactly, so RLS checks are approximations.
- **The CEO** is not built. `lib/ai/coo.ts` is a deterministic planner and report builder.

**CEO autonomy readiness: not ready.** The reasons, in order: the CEO agent does not exist; claims cannot conflict, so the conflict layer cannot be exercised; no real model has ever answered a request; the admin screens have not been seen with data; the schema has not been run on a live database; and the scheduler has no external trigger or operator account. Owner approval is a hard gate on every compliance output and every external action, which is intended, but it means autonomy is bounded by owner throughput.

**Operational blockers.**
1. No real model: install a free local model (see next steps) or obtain a hosted free key.
2. Owner approval to apply migrations 0002 to 0017 to a non-production Supabase project, with a rollback plan.
3. Claim taxonomy decision (subject and value in research and visa outputs) to make conflicts reachable.
4. External scheduler trigger, and an operator account with a password in the environment.
5. Browser check of the admin pages with a signed-in owner on the non-production project.
6. Open findings S1 (quota counter race), S2 (breaker state per process), S3 (operator write on campaigns, migration 0002).
7. Single-task cancellation, stored answer reviews, and an owner screen for held answers are not built.
8. Competitor monitoring is not scheduled, and no live site has been read.

**Exact next steps.**
1. On a development machine with no paid services: install Ollama, run `ollama pull qwen2.5:0.5b`, then set `AI_LOCAL_ENABLED=true` and `AI_LOCAL_MODEL=qwen2.5:0.5b` and run one agent. Record the real output, token counts and time. This is the first real model execution.
2. Decide the claim taxonomy (subject and value in research and visa outputs). Then rewrite `tests/ai/conflict-reachability.test.ts` and add an end-to-end conflict test.
3. Apply migrations 0002 to 0017 to a non-production Supabase project, after owner approval, and run `tests/db` against it.
4. Sign in as the owner on that project and walk through each admin page and control. Record the results here.
5. Only then design the CEO agent, with owner-set limits on what it may decide alone.

## Session 9 additions (multi-agent autonomy)

This section supersedes the session 8 notes that said the consensus, panel, routing and conflicts were not wired.

**1. Quality gate (wired into the engine).**
- Every agent output gets two votes: the quality controller and a compliance lens (policy and brand checks, deterministic code, not a model). The producing agent never counts as its own reviewer.
- Fewer than two independent votes escalates to the owner. A compliance agent's own output has no second reviewer, so it always goes to the owner. Compliance outputs therefore require owner approval.
- A blocking or critical compliance violation is a rejection, and the compliance lens has veto power.
- Disagreement (one reviewer approves, another rejects) escalates to the owner.
- Decisions are recorded in `ai_review_panels` with the votes, exclusions and reasons (codes only). The stored quality review carries the final status, so history and action agree.

**2. Routing (wired into `startWorkflow`).**
- Routable steps (research, strategy, drafting, scripts, creative brief, sales qualification, CRM hygiene, visa research, analytics) go to the least-loaded qualified agent. Load counts open tasks and the choices already made in the run. On a tie, the template's agent wins.
- Pinned, never routed: approvals, customer messages, publishing, compliance reviews, deterministic steps, and anything with a protected capability (publishing, customer support, website operations, payments).
- Each decision is written to `ai_routing_decisions` and audited, with its reasons.
- Known effect: a routable step can now move to another agent that holds the same capability (for example, a sales qualification step may go to the CRM agent). This is the intended behaviour of least-loaded routing; it is noted here so it is not a surprise.

**3. Conflicts (persisted, owner dashboard, audited resolution).**
- Migration 0017 (not applied): `ai_conflicts`, one per run and subject. The operator (scheduler) may record conflicts. Only the owner may resolve them, once. A database trigger refuses any other change, and the column grant limits updates to the resolution fields.
- Owner page `/admin/command-center/conflicts`: pending holds with a link to Approvals, open conflicts with a resolution form, resolved conflicts, reviewer decisions, and routing decisions.
- Resolution is audited with the resolver, the time and the number of agents, never the resolution text.

**4. Agent questions and answers (event-based).**
- New event types `agent.question` (one hop) and `agent.answer` (second hop). The bus refuses a question or answer whose producer is not the named agent, or whose hop count is wrong.
- An answer is produced by running the answering agent through the runtime, then reviewed by the same gate as any output. Only a passing answer is delivered. Answers are audited, not stored as quality reviews, because the review table is keyed by task.
- No handler publishes in response to a question or answer, so an exchange cannot start another one. Each question is asked once, and a question is answered once. At most five questions per run.
- The owner asks an agent from the tasks page, and the exchange shows under the run.

**5. Owner control.**
- Cancel the tasks of a run that have not started, from the tasks page, with confirmation. Running tasks and tasks waiting for approval are left and reported.
- The conflicts page shows pending holds, open and resolved conflicts, reviewer decisions and routing decisions.

**6. Zero-cost rules.** No real model was called. The mock provider is off unless `AI_MOCK_ENABLED=true`. All tests use the mock or a scripted provider. No paid service, no deployment, no push.

**Design decisions taken during implementation (please review).**
- A revision request is work to do, not a disagreement. An approval met by a revision request sends the output back for revision. Escalation is reserved for approval against rejection, and for reviewers asking for owner review.
- When the revision limit is reached, the controller's rejection counts as a revision request, not a reviewer's rejection. Schema failures remain real rejections.
- Every compliance output waits for the owner. For marketing, sales and support runs, the run now stops first at the compliance review. The owner approves that before the publishing or customer-message approval appears. This follows the approved rule, and it adds one owner decision per run.

**Not verified, and why.**
- **Conflicts raised by the engine are not covered by an end-to-end test.** Claim keys are text-based, so reproducing a conflict through a fixed mock output is fragile. The store, the migration and the resolution are tested, and the detection rule is tested at the quality-check level.
- **The new pages were not checked in a browser.** They are behind the admin login, which needs a live database.
- **Migration 0017 has been tested on PGlite only.** It has not been applied to any database.
- **Answers use the real runtime.** With no model configured, an answer fails honestly and is audited. With a real model configured, the owner's question would run a real call. This was not exercised.

**Still open.**
- Owner-facing cancellation of a single task (only whole runs are cancellable).
- Persisted answer reviews (answers are audited, not stored in a table).
- A review screen for held answers. They appear only in the audit log.
- Weighted consensus is set in code, not by the owner.
- Autonomous CEO: not started, as the brief asks.

## Session 8 additions (multi-agent intelligence)

**Audit before starting.**
- **Handoffs:** the `agent.handoff` event type was declared, subscribed, validated and tested, but no production code published one. Agents passed work to each other only through task dependencies.
- **Quality review:** one deterministic review per output. No second reviewer, no consensus, no conflict decision.
- **Execution trace:** `buildRunTrace` existed but had no production caller, so no one could see it.
- **Cancellation:** a waiting approval was cancelled on expiry, but an owner could not cancel a run.
- **Already present, not rebuilt:** the event bus with validation and hop limits, the dependency graph with cycle detection, idempotent events, business memory and briefing, learning memory, provider timeouts, failure recovery for stale tasks, and retries with backoff.

**Built and tested.**
- **Handoffs between agents (wired into the engine).** When a step succeeds, the engine publishes one `agent.handoff` per direct dependent step that another agent will run. The event is idempotent per pair of tasks, and carries identifiers and a fixed summary, never the output. Verified on the sales workflow (CRM agent to sales agent): one handoff, received and remembered, none repeated on a second pass, none to the same agent.
- **Execution trace (wired to the tasks page).** Each of the three newest runs shows its steps, agents, statuses, attempts, dependencies, latest review, handoffs and conflicting claims. Identifiers and codes only. Labels are in Arabic, French and English.
- **Owner cancellation of a run.** Cancels tasks that have not started. A running task is reported as running and left to finish. A task waiting for an approval is left for the owner's decision. Agents and the system are refused. Audited with counts only.
- **Consensus across independent reviewers (pure module, not yet called by the engine).** A reviewer's vote on its own output is excluded. One vote per reviewer. At least two independent reviews are needed, otherwise the result escalates to the owner. A veto reviewer's rejection is final. Disagreement (one approves, another rejects) escalates rather than being decided by majority. Any revision request sends the output back. Weights are configurable.
- **Review panel (pure module, not yet called by the engine).** Two independent votes per output: the full quality controller, and a compliance lens made of the policy and brand checks. A blocking policy breach is a compliance rejection, not an ordinary revision.
- **Conflict resolution (pure module).** Only the owner can resolve a conflict between agents' claims, and a resolution is final.
- **Capability-based routing (pure module, not yet used for task creation).** Routes a capability to the available agent with the least open work, with a fixed tie-break. Reassignment is refused for capabilities that can act outside the platform (publishing, customer messages, website changes).

**Tests added.** 5 handoff tests on the real engine; 26 consensus, conflict, routing and panel tests; 2 trace tests; 4 cancellation tests. The consensus tests include the independence, owner-only and no-output-text checks.

**Not done, and why.**
- **The consensus and panel are not part of the engine's quality gate.** Wiring them in would change the outcome of every agent output, and would send compliance outputs to the owner, because the compliance agent cannot review its own work. That is an owner decision, so I have not made it.
- **Routing does not choose the agent for any task yet.** The templates still name the agent for each step.
- **Conflicts are not stored.** The conflict record and its owner decision exist as pure functions. A table and an owner screen are needed.
- **Owner cancellation has no button yet.** It exists as a method only.
- **Running tasks cannot be cancelled.** An in-flight model call cannot be stopped safely.
- **Agent-to-agent conversation is not built.** Handoffs are one-way notices attached to finished work. Agents do not ask each other questions.
- **Weighted consensus is configured in code,** not by the owner in the interface.
- **Not run against a real model.** Every agent test uses the mock provider, and the mock is off by default now (see session 7).

**Autonomous CEO** has not been started, as the brief asks. Its prerequisites are the routing and consensus wiring above, and an owner decision on which decisions it may take alone.

## Session 7 additions (production-readiness audit)

**Defect fixed: fake agent execution.** The mock provider was enabled by default and always first in the chain. With no real provider configured, every agent task succeeded with the workflow's placeholder output (for example "Mock follow-up." and `draft_ref: "mock"`), which was stored, reviewed and offered as a draft. The mock is now off unless `AI_MOCK_ENABLED=true` and `NODE_ENV` is not `production`. With no real provider, tasks fail honestly with "no providers configured". Tests cover the default and the production refusal.

**Added: daily business reports.** Owner-only. Builds four notices from stored rows, once per day each: sales (leads, new in 24 hours and 7 days, open, converted, lost, follow-ups waiting, scheduled and overdue), marketing (active and paused campaigns, KPIs with and without a reading), customer alerts (hot leads idle two days, high-intent leads without a follow-up, overdue scheduled follow-ups), and rule-based recommendations, each with its evidence. Notices carry counts and ids, never names. Recommendations are labelled rule-based, not model output. Available from the notifications page ("Generate today's reports"). The notice kinds were added to migration 0012, which is not yet applied.

**Removed:** the empty `lib/ai/agents` directory.

**Audit results.**
- Admin server actions: all eight in `lib/actions/admin.ts` check for an active admin profile. The owner-session actions (`ai`, `campaigns`, `crm`, `memory`, `knowledge`, `notifications`, `scheduler`) call the owner check. Customer actions bind records to the signed-in user and rely on row-level policies (checked in migration 0001).
- No service-role key is used. No secret-shaped string appears in source. The only `dangerouslySetInnerHTML` is static structured data on the home page.
- Error and loading boundaries exist for the site and for the command center.

**Not verified, and why.**
- **Real model calls and token and cost accounting against a real model:** no key is available. Only the mock path and the local test server have run.
- **Admin dashboard pages with data:** these need a signed-in owner and a live database. The browser test covers public pages and the redirect only.
- **Scheduled daily reports:** the scheduler runs as the operator account, which by design cannot read CRM data. The reports are generated from the owner's session. A scheduled version needs a decision (owner-scoped report functions, or a separate reviewed role). It is not built.

**Still open from the audit.**
- **Conflict resolution:** cross-agent conflicts are detected and shown in the execution trace. Nothing resolves them.
- **CEO orchestration:** `lib/ai/coo.ts` is a deterministic planner and report builder. It does not assign work autonomously.
- **Delegation and specialist review:** the task dependency graph and the quality reviews exist. Agent-to-agent communication and quality consensus do not.
- **Earlier findings still open:** S1 (quota counter race), S2 (breaker state per process), S3 (operator write on `ai_campaigns` from migration 0002).
- **Production readiness:** not ready. Blockers are listed under External blockers.

## Session 6 additions (competitor intelligence, phase 1)

**Audit before starting.** The CRM from session 5 is complete for its core. Still open from that session: AI enrichment (no model key), the funnel on the overview and analytics pages, and store-level tests for the Supabase CRM store. The visa allowlist (`ai_sources_allowlist`) holds bare hosts for visa research. It was not reused for competitors, because competitor sources need a URL, a reviewed-terms record, a read interval and a read history.

**Built and tested (migration 0016, not applied):**
- **Approved source registry:** `ai_competitor_sources`. Only https URLs on public DNS names are accepted: no IP literals, no credentials, no non-default ports, no fragments, no localhost or internal names. The owner must confirm the terms are reviewed. The URL, host and terms record are fixed after registration (column-level grants). A different page needs a new source. Sources can be paused.
- **Public monitoring:** the fetcher reads robots.txt for the generic agent first. A disallowed page is not read. A robots file that cannot be read because of a server error fails closed. Redirects are refused, the timeout is 15 seconds, the page size is capped at 1 MB, and only HTML or plain text is accepted. A failure is returned as a status, never thrown, so one bad source cannot stop a run.
- **Read interval:** a source is read at most once per configured interval (6 hours minimum). An owner can force a read.
- **Offer extraction:** displayed prices in DZD, EUR, USD, MAD and TND, read before or after the currency symbol, stored in minor units with up to 60 characters of context. Only what the page displays is recorded. Nothing is estimated.
- **Change detection:** content hash, price added or removed, and lowest-price up or down per currency. The first read is a baseline with no changes. A failed read is never compared against.
- **Opportunities and threats:** a competitor's lowest price going up, or an offer being removed, is an opportunity. A price going down, or an offer being added, is a threat. These are owner-facing signals only.
- **Observations are append-only.** Every read is stored with its status, including failures, so the history shows gaps.
- **Owner-only service:** agents and the system are refused. Every read is audited with its status and change codes.

**Not built in this phase:**
- **Owner page for the competitor report.** The service and report exist and are tested. The page and its translations are not built. This is the first item for phase 1 follow-up.
- **Scheduled monitoring.** Reads run only when the owner calls `monitor`. The scheduler is not wired to it yet, and no live site has been read.
- **Pricing intelligence beyond the lowest price per currency,** and market opportunity detection that combines the competitor data with the business's own prices. The platform has no store of its own prices yet.
- **Live verification.** All tests use a fake HTTP layer. No real competitor site has been read, and no outbound request was made from this environment.

## Remaining incomplete features

Priority order follows the brief's list.

- **Marketing command center (6):** dashboard exists; the redesign to the owner's reference design is not started. The reference video was not accessible.
- **Campaign management (7):** not started. Only the `ai_campaigns` table exists.
- **Content generation and approval (8):** content agents and approval gating exist. No provider is connected, and nothing is published.
- **Analytics and performance (9):** monitoring and observability exist. The analytics workflow uses deterministic aggregation only. No live data source.
- **Competitor intelligence (phase 1 of the directive):** registry, monitoring, change detection and report are built. Missing: the owner page, scheduling, and combining with the business's own prices.
- **Lead management and sales automation (10):** CRM core built in session 5 (leads, pipeline, history, scoring, follow-up approval). Not yet built: AI enrichment, competitor-aware sales actions, and the sales agents' use of the CRM.
- **Notifications and reporting (11):** core built (inbox service, rules, triggers, migration 0012 unapplied). Missing: the inbox page, the scheduled owner report, and an independent check for a missing worker.
- **Admin dashboard and owner controls (12):** mostly built. Knowledge base create and edit forms are not built; the knowledge base is read-only in the dashboard.
- **Agents and business memory:** agents do not yet read business memory or quality feedback.
- **Scheduled reports:** would use the scheduler, but no report job kind exists yet.

## External blockers

1. Owner approval to apply migrations 0002 to 0011 to a non-production Supabase project, with a migration plan and a recovery plan.
2. An AI provider: a free local model (needs installation) or a hosted free tier (needs a key). No key has been provided, and no paid service is used.
3. An external trigger for the scheduler (see `SCHEDULER.md`).
4. An operator account for the scheduler, created in Supabase after migration.
5. A decision on revoking TRUNCATE on the original customer tables.
6. The branch to push to, and approval to push. Nothing has been pushed.
7. The owner's design reference video, or confirmation of the design direction.

## Completion

Estimated **about 72%** of planned platform features (session 5 moved the CRM from not started to built), by module count with partial modules counted at half weight. This is a judgement, not a measured figure. At the first checkpoint: 10 of 17 modules built, 5 partial, 2 not started. Session 2 moved business memory and notifications forward. Session 3 completed notifications and added campaigns, content review and knowledge admin. Partial modules still count at half weight, because the Supabase store paths are not yet store-tested and no rendered browser check has been done.

## Recommended next priorities

1. Get the owner's approval to apply migrations 0002 to 0015 to a staging project, then run the two-connection lease race and the browser checks for the scheduler page.
2. Configure one external trigger and an operator account in staging, and run the scheduler for a day before enabling it in production.
3. Connect one AI provider (local free model preferred) and run the agents through the quality gate with real output.
4. Build notifications and the scheduled owner report, using the scheduler's job kind mechanism.
5. Build campaign management on top of the existing workflow and approval engine.
6. Build knowledge base create and edit forms with the existing rules.

## Phase 13: Owner control and approval center (partial, local)

Status: the decision core, CRM transition control and tests are built and verified locally. The approval-center page, the source registry and two review hooks are **not built yet**. Nothing is pushed, nothing deployed, and migration 0018 is **not applied**.

### Built and verified

- `lib/ai/review/rules.ts`: review kinds (held_answer, escalated_claim, crm_stage_disagreement, rejected_proposal, crm_transition), statuses, allowed decisions per kind, 7-day expiry.
- `lib/ai/review/service.ts`: owner-only open, list, get and decide. Each decision is checked for kind, state and expiry, requires the version the owner saw, runs a precheck for approvals that can go stale, is written as a compare-and-set, is audited (actor, previous and new status, reason), and only then runs its effect. Refusals are audited as `review.refused`.
- `lib/ai/review/store.ts` and `supabase-store.ts`: compare-and-set decide in memory and on Supabase.
- `lib/ai/review/center.ts`: wires effects and prechecks. Approved CRM transitions are re-checked before they are recorded and then applied through the CRM service. Approved held answers are delivered through `CommunicationService.deliverApproved` (owner only, one hop).
- `lib/ai/crm/*`: transition kinds (standard, exceptional, forbidden). Exceptional moves (reopening a lost lead) become a review item and are not applied directly. Lead version and compare-and-set saves stop stale updates. Every move is audited with previous and new versions.
- `lib/ai/services.ts`: composition root builds the review center. CRM and communication open items through it.
- `lib/ai/collaboration/communication.ts`: held answers open a `held_answer` item with sources and reason codes when a review dependency is supplied.

### Migration 0018 (NOT applied; owner approval required)

`supabase/migrations/0018_owner_approval_center.sql`:
- Creates `ai_review_items` with kind and status checks, JSON size limits, a decided-consistency check, and a guard trigger that blocks changes to decided items and to the fields that identify what is being approved.
- RLS: admin can read and decide; admin or operator can insert. Anonymous access is revoked. Delete and truncate are revoked.
- Adds `ai_leads.version` with a bump trigger.
- Adds `category`, `jurisdiction`, `status`, `expires_at`, `validated_at` and `updated_at` to `ai_sources_allowlist`.
- Applies cleanly on PGlite in the migration chain test. It has not been run against any real Supabase project.

### Tests

- `tests/ai/review-center.test.ts` (13), `tests/ai/review-integration.test.ts` (11, end-to-end CRM approval, held-answer delivery once, duplicate and replay refusal, stale refusal, expiry, agent and system refusal, audit), `tests/ai/crm-concurrency.test.ts` (10), CRM service and rules tests updated for versions.
- `tests/db/migration-validation.test.ts` and `migration-chain.test.ts` updated to include 0018.
- `npm run verify` passes: lint with zero warnings, typecheck, 953 tests, production build.

### Not built yet

1. Approval-center page (`app/[locale]/admin/command-center/review/`) with decision forms and server actions in `lib/actions/review.ts`.
2. Source registry service and UI over `ai_sources_allowlist`: add, edit, disable, revalidate, official-source priority. The visa allowlist still reads the host list directly.
3. Hooks for escalated stage disagreements (StageAnswerService) and rejected proposals (engine REJECTED branch). Rejected-proposal `request_revision` only records the request; the orchestrator has no retry entry point.
4. Escalated claims are still shown only through existing approvals.

### Known risks

- Effects run after the decision is recorded. If an effect fails after recording, the decision is not rolled back. The precheck reduces this for CRM transitions only.
- Audit uses the existing `ai_events` table, with previous and new values in `meta`. There is no separate decisions table.
- Source host approval is not content verification.
- The Supabase store and RLS policies are tested on PGlite and in unit tests only.

### Owner decisions needed

- Approve applying migration 0018 to a staging project.
- Confirm the remaining items (page, source registry, two hooks) before they are built.

## Phase 13 continuation: approval center, source registry, missing hooks (local)

Status: built and verified locally. Migration 0018 is **still NOT applied**: it waits for the owner's review. Nothing pushed, nothing deployed.

### Added

- **Approval center** `/command-center/review`: open items with evidence, source URLs, agent, task, lead and timestamps; decision forms limited to the kind's allowed decisions; decided history. Server action `lib/actions/review.ts`.
- **Source registry** `/command-center/sources`: add, edit (category, jurisdiction, purpose, expiry), disable and enable, mark as checked today (revalidate), remove. Every change needs a reason, is checked against the row's version, and is audited with previous and new values. `lib/ai/sources/*`, actions `lib/actions/sources.ts`. The visa research allowlist now reads usable hosts from this registry, official sources first.
- **Hooks**:
  - Stage disagreements: `StageAnswerService` opens a `crm_stage_disagreement` item when the model and the record disagree. The record stays the answer.
  - Rejected proposals: the engine opens a `rejected_proposal` item when quality review rejects an output. `request_revision` requeues the same task through `retryTask`, only if the task is still failed, so a duplicate request is refused and recorded nothing.
- **Exactly-once**: held answers are delivered once through the event bus idempotency key, and the review decision is a compare-and-set, so two simultaneous approvals deliver one answer.

### Migration 0018 changes in this round (not applied)

- Review guard: a decision must move to approved, rejected, revision_requested or expired; the version must rise by exactly one; the item identity fields (agent, run, task, lead) are immutable.
- Source registry: new `version` column and a trigger that bumps it on every change.
- Rollback script: `docs/migrations/0018_rollback.sql`, outside the migration chain. It is tested on PGlite together with the forward migration.

### Tests

- `tests/ai/review-hooks.test.ts` (11): rejection path through the real engine, requeue, duplicate refusal, reject, approve refused, stage disagreement, owner-only, exactly-once under simultaneous approval.
- `tests/ai/sources.test.ts` (24): host and metadata rules, usability, revalidation, official priority, authorization, stale writes, disable and enable, expiry, removal, audit.
- `tests/db/owner-approval.test.ts` (11): guard, version rule, defaults, registry version trigger, rollback.
- `npm run verify`: passes. 999 tests, lint with zero warnings, typecheck, production build.

### Remaining risks

- Per-item audit history is not a separate view. Decisions are audited in `ai_events` and shown on the item (status, decided by, time, reason). The full trail is on the existing audit page.
- Effects still run after the decision is recorded. A failure after recording is not rolled back. Preconditions (CRM precheck, task-still-failed check) reduce this.
- Server actions have no automated test in this environment; owner checks in them use the existing `ownerId()` (profile role admin, active) and the services enforce owner-only independently.
- `escalated_claim` remains visible through the existing approvals only.
- Registry expiry is end-of-day UTC.

## Phase 13.1: approval security hardening (local)

Migration 0018 is still **NOT applied** and waits for owner review. Tests run on PGlite only, never on a real Supabase project.

### Security fixes
- Source registry: the broad `for all` policy from 0002 is replaced. Owner-only insert and update, operator and admin read, no client delete for any role.
- Removal is a terminal status. Rows are never deleted.
- Every source change needs its own reason. The database checks this on each write, and the reason is stored on the row.
- Approver and host of a source cannot change. Database audit rows (`db.source.*`, `db.review.decided`) are written by triggers, alongside the application audit.
- Operators can read the registry (previously they could not, which left scheduled visa research without approved hosts). They cannot write it.

### Rollback
- `docs/migrations/0018_rollback.sql` copies review items and source metadata into archive tables, checks the copies with checksums, and only then drops anything. It needs `gta.rollback_confirmed = 'yes'`, refuses to overwrite an earlier archive, and runs in one transaction.
- Destructive steps: review items leave the live schema (archived), registry metadata columns are removed (archived), `ai_leads.version` is removed. Audit history and host rows are untouched.
- `docs/migrations/0018_backup_procedure.md`: fingerprints, export, verification in a disposable database, rollback, post-check.

### Audit recovery
- `recordCorrection`: a correction is a new audit entry that quotes the original decision (status, decider, time, reason) and the owner's correction reason. The item and its decision never change. Nothing is reversed automatically.

### Duplicate prevention
- `openOnce`: a repeated request for the same kind, subject and payload returns the open item. Applies to CRM reopens, held answers, rejected outputs and stage disagreements.

### Tests added
- `tests/db/owner-approval.test.ts` and `rollback-verification.test.ts` (23, PGlite, full migration chain through 0018)
- `tests/ai/approval-matrix.test.ts` (16): every review kind, every decision, every actor
- `tests/ai/approval-security.test.ts` (8): corrections, duplicate prevention
- `tests/actions/approval-actions.test.ts` (20): server actions for review, sources and CRM transitions, with owner check, denial, duplicates, concurrency
- `tests/ai/review-hooks.test.ts` (12): requeue, context preservation, single execution per attempt

`npm run verify` passes: 1,056 tests, lint with zero warnings, typecheck, production build.

### Remaining risks
- Everything database-side was tested on PGlite with stubbed auth. Real Supabase behaviour is not proven until a staging run.
- Migration 0010 (append-only hardening) is still a proposal. The database audit triggers rely on `ai_events` being append-only, and that is only enforced once 0010 is applied.
- The real `ownerId()` check (profile role) is not exercised by the action tests, which mock it.
- A database owner can disable a trigger. Fingerprints and archives detect it after the fact.
- Removed hosts cannot be re-added (the host is the primary key). Needs a decision.
- Corrections have no screen yet. Several corrections on one item are allowed.
- An effect that fails after a decision is recorded is not rolled back.

## Phase 13.2: staging readiness and audit integrity (local)

Migration 0018 is **NOT applied** anywhere. The staging run waits for owner approval. Production is forbidden for this work.

### Supabase inspection (read only)
- Project `globaltravelassi` (`feknppmxasoxmwplxvpa`): active, Postgres 17.12. Migration history empty. None of the `ai_*` tables exist. Base tables present, with rows (customer-shaped). **Not a staging target.**
- Project `visa-ready-dz` (`pcreairqaqxistybmnnb`): inactive. Not inspected further.
- No migration, query or write was executed against either project.

### Source lifecycle
- Statuses: `active`, `disabled`, `retired`. Removal is no longer a status (`removed` renamed to `retired`).
- Retirement is terminal for owner edits. A retired host can only ask to come back.
- Reactivation is a `source_reactivation` review item. Approving it runs `ai_reactivate_source` in the database. The function is owner-only and needs an approved item for this host and exact version. It runs once: the version moves on after use.
- Host identity, approver and approval time are kept through retirement.

### Audit integrity
- `ai_audit_integrity_report()` (owner only, read only): 12 checks covering the append-only trigger on `ai_events`, the no-truncate trigger, the review and registry triggers, the client privileges on `ai_events`, review items and the registry, the removal of the broad policy, and the reactivation function.
- Client roles no longer hold UPDATE, DELETE or TRUNCATE on `ai_events`. INSERT is kept.
- A database owner can disable a trigger. The report shows it. Tested.

### Corrections
- `CorrectionCenter` reads correction events from the audit trail (append-only). Each row shows the original decision (status, decider, time, reason), the correction, who recorded it and when.
- Page `/command-center/corrections`. Form to record a correction on the review page. Originals are never changed.

### Manifest and plan
- `scripts/migration-manifest.mjs` writes `docs/migrations/manifest.json`: SHA-256 for every migration and the 0018 rollback. A test fails if a file changes without the manifest being regenerated.
- `docs/staging/execution-plan.md`: inspection results, gates, ordered migrations with checksums, backup, post-migration checks, rollback.

### Tests added
- `tests/ai/source-lifecycle.test.ts` (15): transitions, reasons, retirement, reactivation approvals, reuse, concurrency.
- `tests/ai/correction-center.test.ts` (6): what is shown, ordering, authorization, append-only.
- `tests/db/audit-integrity.test.ts` (9): report, disabled-trigger detection, append-only privileges, database audit rows.
- `tests/db/migration-dependencies.test.ts` (9): order, 0010 dependency, 0018 applies without 0010 and reports the gap, checksums.
- `tests/db/owner-approval.test.ts` extended: retirement, reactivation refusal, approved reactivation and replay refusal.
- `tests/db/rollback-verification.test.ts` extended: reactivation and report functions removed, audit privileges closed.
- `npm run verify`: passes. 1,102 tests, lint with zero warnings, typecheck, production build.

### Remaining risks
- Migration 0010 is still a proposal in the repository. The audit guarantees depend on it.
- The database checks run on PGlite with stubbed auth. A staging run is needed to prove them on Postgres 17 with Supabase roles.
- A database owner can disable a trigger, and the report only detects it after the fact.
- No hash chain on `ai_events`: a privileged edit that also avoids the trigger would not be detected by content.
- Operators can read the registry (kept from 13.1).
- Corrections can be recorded more than once per item.
- A host retired and then reactivated keeps its row. Re-adding a deleted-looking host is not possible (host is the key), which is intended.
