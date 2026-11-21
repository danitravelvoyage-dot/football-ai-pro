import { describe, it, expect } from "vitest";
import { checkSource, validateResearch, validateAnswerSources, validateStage, validateAgainstMemory, combineVerdicts } from "@/lib/ai/factual/validate";

const APPROVED = ["official.example.dz"];
const GOOD = "https://official.example.dz/visa/checklist";

describe("fabricated URLs and sources are refused", () => {
  it.each([
    ["not a URL", "invalid_url"],
    ["http://official.example.dz/x", "insecure_url"],
    ["https://user:pw@official.example.dz/x", "credentials_in_url"],
    ["https://official.example.dz:9/x", "non_default_port"],
    ["https://192.168.0.5/x", "not_a_public_host"],
    ["https://localhost/x", "not_a_public_host"],
    ["https://intranet.internal/x", "not_a_public_host"],
  ])("%s is fabricated (%s)", (url, code) => {
    const issue = checkSource(url, APPROVED, "p");
    expect(issue?.status).toBe("fabricated");
    expect(issue?.code).toBe(code);
  });

  it("a well-formed public address the owner has not approved is uncertain, not accepted", () => {
    const issue = checkSource("https://made-up-agency.example.com/rules", APPROVED, "p");
    expect(issue).toMatchObject({ code: "unapproved_source", status: "uncertain" });
  });

  it("a source on an approved host passes", () => {
    expect(checkSource(GOOD, APPROVED, "p")).toBeNull();
  });
});

describe("research: unsupported findings and missing evidence", () => {
  it("a finding with no source needs evidence, whatever its confidence", () => {
    const v = validateResearch([{ sources: [] }, {}], APPROVED);
    expect(v.status).toBe("needs_evidence");
    expect(v.issues.map((i) => i.path)).toEqual(["findings[0]", "findings[1]"]);
  });

  it("a finding with a fabricated URL is refused", () => {
    expect(validateResearch([{ sources: ["javascript:alert(1)"] }], APPROVED).status).toBe("fabricated");
  });

  it("a finding with a valid, approved source is verified", () => {
    expect(validateResearch([{ sources: [GOOD] }], APPROVED)).toEqual({ status: "verified", issues: [] });
  });

  it("one bad finding makes the whole output's status the most severe one", () => {
    const v = validateResearch([{ sources: [GOOD] }, { sources: ["https://evil.example.com/x"] }, { sources: [] }], APPROVED);
    // An unapproved source (uncertain) is more severe than a finding with no evidence (needs_evidence).
    expect(v.status).toBe("uncertain");
    expect(v.issues.map((i) => i.code).sort()).toEqual(["missing_evidence", "unapproved_source"]);
  });
});

describe("free-text answers: an answer without approved evidence is for the owner", () => {
  it("an answer with no sources is uncertain, so it is not delivered automatically", () => {
    expect(validateAnswerSources([], APPROVED)).toMatchObject({ status: "uncertain", issues: [{ code: "unsupported_answer" }] });
  });

  it("an answer that cites an approved source is verified", () => {
    expect(validateAnswerSources([GOOD], APPROVED).status).toBe("verified");
  });
});

describe("CRM stages: only the CRM's stages, and only what the record says", () => {
  it("a stage the CRM does not define is refused", () => {
    expect(validateStage("Boundaries", null)).toMatchObject({ status: "fabricated", issues: [{ code: "nonexistent_stage" }] });
    expect(validateStage("Prospect", { stage: "new" })).toMatchObject({ status: "fabricated" });
  });

  it("the stage is checked case-sensitively: a renamed stage is not accepted", () => {
    expect(validateStage("New", { stage: "new" }).status).toBe("fabricated");
  });

  it("a defined stage that disagrees with the stored lead record is uncertain, and goes to the owner", () => {
    expect(validateStage("contacted", { stage: "new" })).toMatchObject({ status: "uncertain", issues: [{ code: "contradicts_record" }] });
  });

  it("a defined stage that matches the stored lead record is verified", () => {
    expect(validateStage("new", { stage: "new" })).toEqual({ status: "verified", issues: [] });
  });
});

describe("contradictory business memory", () => {
  it("a claim whose value differs from the owner's memory for the same key is uncertain", () => {
    const v = validateAgainstMemory([{ key: "visa:FR|passport", value: "Valid 6 months", path: "requirements[0]" }], [{ key: "visa:FR|passport", value: "Valid 3 months" }]);
    expect(v).toMatchObject({ status: "uncertain", issues: [{ code: "contradicts_memory", path: "requirements[0]" }] });
  });

  it("a claim that agrees with the owner's memory is verified, and a claim with no memory key is not judged", () => {
    expect(validateAgainstMemory([{ key: "k", value: "a", path: "p" }], [{ key: "k", value: "a" }]).status).toBe("verified");
    expect(validateAgainstMemory([{ key: "other", value: "x", path: "p" }], [{ key: "k", value: "a" }]).status).toBe("verified");
  });
});

describe("combining verdicts keeps the most severe status", () => {
  it("fabricated beats uncertain beats needs_evidence beats verified", () => {
    expect(combineVerdicts({ status: "verified", issues: [] }, { status: "needs_evidence", issues: [] }).status).toBe("needs_evidence");
    expect(combineVerdicts({ status: "needs_evidence", issues: [] }, { status: "uncertain", issues: [] }).status).toBe("uncertain");
    expect(combineVerdicts({ status: "uncertain", issues: [] }, { status: "fabricated", issues: [] }).status).toBe("fabricated");
  });
});
