import { describe, it, expect } from "vitest";
import { makeHarness, OWNER, AGENT } from "./helpers";
import { CommunicationService, MAX_QUESTIONS_PER_RUN, answerDefinition } from "@/lib/ai/collaboration/communication";
import { EventValidationError } from "@/lib/ai/events/bus";
import { getAgent } from "@/lib/ai/registry";

function setup(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  const comm = new CommunicationService({
    bus: h.events,
    events: h.eventStore,
    runtime: h.runtime,
    quality: h.quality,
    collaboration: h.collab,
    audit: h.audit,
    now: h.clock.now,
    newId: h.ids,
  });
  return { h, comm };
}

const RUN = "run-exchange-1";
const q = (over: Partial<{ runId: string; fromAgent: "SalesAgent" | "CRMAgent" | "ComplianceAgent"; toAgent: "SalesAgent" | "CRMAgent" | "ComplianceAgent"; question: string }> = {}) => ({
  runId: RUN,
  fromAgent: "SalesAgent" as const,
  toAgent: "CRMAgent" as const,
  question: "Which lead stage is the family enquiry in?",
  ...over,
});

describe("who may start an exchange", () => {
  it("lets the owner ask an agent on the agent's behalf", async () => {
    const { comm, h } = setup();
    const { questionId } = await comm.ask(OWNER, q());
    expect(questionId).toBeTruthy();
    expect(h.audit.events.some((e) => e.type === "agent.question_asked" && e.actor === `owner:${OWNER.id}`)).toBe(true);
  });

  it("refuses an agent starting an exchange itself", async () => {
    const { comm } = setup();
    await expect(comm.ask(AGENT, q())).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses an owner with no identity", async () => {
    const { comm } = setup();
    await expect(comm.ask({ kind: "owner", id: " " }, q())).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("question rules", () => {
  it("refuses an agent asking itself", async () => {
    const { comm } = setup();
    await expect(comm.ask(OWNER, q({ fromAgent: "CRMAgent", toAgent: "CRMAgent" }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses a question that is too short or too long", async () => {
    const { comm } = setup();
    await expect(comm.ask(OWNER, q({ question: "hi" }))).rejects.toMatchObject({ code: "invalid" });
    await expect(comm.ask(OWNER, q({ question: "x".repeat(501) }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses personal data in a question", async () => {
    const { comm } = setup();
    await expect(comm.ask(OWNER, q({ question: "Call the client on +213555123456 today" }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("caps the number of questions in one run", async () => {
    const { comm } = setup();
    for (let i = 0; i < MAX_QUESTIONS_PER_RUN; i++) await comm.ask(OWNER, q({ question: `Question number ${i} about the file` }));
    await expect(comm.ask(OWNER, q({ question: "One more question about the file" }))).rejects.toMatchObject({ code: "limit" });
  });
});

describe("answers", () => {
  it("delivers an answer that passes the two-reviewer gate, one hop back to the asker", async () => {
    const { comm, h } = setup();
    const { questionId } = await comm.ask(OWNER, q());
    const result = await comm.answer(OWNER, { runId: RUN, questionId });
    expect(result.status).toBe("delivered");
    const answers = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]?.target).toBe("SalesAgent");
    expect(answers[0]?.hopCount).toBe(2);
    expect((answers[0]?.payload as { questionId: string }).questionId).toBe(questionId);
  });

  it("the asker stores the delivered answer as memory", async () => {
    const { comm, h } = setup();
    const saved: string[] = [];
    const original = h.store.saveMemory.bind(h.store);
    h.store.saveMemory = async (agent, key, summary, at) => {
      saved.push(`${agent}|${key}`);
      return original(agent, key, summary, at);
    };
    const { questionId } = await comm.ask(OWNER, q());
    await comm.answer(OWNER, { runId: RUN, questionId });
    await h.events.dispatch({ limit: 50 });
    expect(saved.some((x) => x.startsWith("SalesAgent|answer:"))).toBe(true);
  });

  it("holds an answer from the compliance agent, because it has no independent second reviewer", async () => {
    const { comm, h } = setup();
    const { questionId } = await comm.ask(OWNER, q({ fromAgent: "SalesAgent", toAgent: "ComplianceAgent" }));
    const result = await comm.answer(OWNER, { runId: RUN, questionId });
    expect(result.status).toBe("held");
    const answers = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.answer");
    expect(answers).toHaveLength(0);
    expect(h.audit.events.some((e) => e.type === "agent.answer_held")).toBe(true);
  });

  it("answers each question once", async () => {
    const { comm } = setup();
    const { questionId } = await comm.ask(OWNER, q());
    await comm.answer(OWNER, { runId: RUN, questionId });
    await expect(comm.answer(OWNER, { runId: RUN, questionId })).rejects.toMatchObject({ code: "already_answered" });
  });

  it("refuses to answer a question that does not exist in the run", async () => {
    const { comm } = setup();
    await expect(comm.answer(OWNER, { runId: RUN, questionId: "no-such-question" })).rejects.toMatchObject({ code: "unknown_question" });
  });

  it("records a failed answer in the audit trail and delivers nothing when no model is available", async () => {
    const { comm, h } = setup({ providers: [] });
    const { questionId } = await comm.ask(OWNER, q());
    const result = await comm.answer(OWNER, { runId: RUN, questionId });
    expect(result.status).toBe("failed");
    expect(h.audit.events.some((e) => e.type === "agent.answer_failed")).toBe(true);
    const answers = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.answer");
    expect(answers).toHaveLength(0);
  });

  it("produces the answer with the answering agent's own prompt and boundaries", () => {
    const def = answerDefinition("CRMAgent");
    expect(def.prompt.system).toBe(getAgent("CRMAgent").prompt.system);
    expect(def.boundaries).toEqual(getAgent("CRMAgent").boundaries);
    expect(def.outputKind).toBe("answer");
  });
});

describe("loop prevention and the bus rules", () => {
  it("refuses a question that does not travel exactly one hop", async () => {
    const { h } = setup();
    await expect(
      h.events.publish({
        type: "agent.question",
        producer: "SalesAgent",
        target: "CRMAgent",
        payload: { fromAgent: "SalesAgent", toAgent: "CRMAgent", questionId: "qq1", runId: RUN, question: "Which stage is it in?" },
        idempotencyKey: "agent.question:qq1-hop",
        correlationId: RUN,
        hopCount: 2,
      }),
    ).rejects.toBeInstanceOf(EventValidationError);
  });

  it("refuses an answer published by an agent other than the one answering", async () => {
    const { h } = setup();
    await expect(
      h.events.publish({
        type: "agent.answer",
        producer: "SalesAgent",
        target: "CRMAgent",
        payload: { fromAgent: "CRMAgent", toAgent: "SalesAgent", questionId: "qq2", runId: RUN, answer: "Stage two." },
        idempotencyKey: "agent.answer:qq2-forged",
        correlationId: RUN,
        hopCount: 2,
      }),
    ).rejects.toBeInstanceOf(EventValidationError);
  });

  it("does not deliver the same question twice: a repeated publish is not created again", async () => {
    const { h } = setup();
    const input = {
      type: "agent.question" as const,
      producer: "SalesAgent" as const,
      target: "CRMAgent" as const,
      payload: { fromAgent: "SalesAgent", toAgent: "CRMAgent", questionId: "qq3", runId: RUN, question: "Which stage is it in?" },
      idempotencyKey: "agent.question:qq3-once",
      correlationId: RUN,
      hopCount: 1,
    };
    const first = await h.events.publish(input);
    const second = await h.events.publish(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it("an answer cannot itself start a new question: no handler publishes in response", async () => {
    const { comm, h } = setup();
    const { questionId } = await comm.ask(OWNER, q());
    await comm.answer(OWNER, { runId: RUN, questionId });
    await h.events.dispatch({ limit: 100 });
    const questions = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.question");
    expect(questions).toHaveLength(1);
  });
});

describe("exchanges are visible to the owner", () => {
  it("lists each question with its answer once delivered, and nothing for other runs", async () => {
    const { comm } = setup();
    const { questionId } = await comm.ask(OWNER, q());
    await comm.ask(OWNER, q({ runId: "other-run", question: "A different question about another run" }));
    await comm.answer(OWNER, { runId: RUN, questionId });
    const items = await comm.exchanges(RUN);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ questionId, fromAgent: "SalesAgent", toAgent: "CRMAgent" });
    expect(items[0]?.answer).toBeTruthy();
  });
});
