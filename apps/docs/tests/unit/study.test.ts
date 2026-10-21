import { describe, expect, it } from "vitest";
import type { StudyExport } from "@/hooks/query/study";
import { eventsCsv, questionnaireCsv, toCsv } from "@/lib/study/export";
import { FINAL_QUESTIONNAIRE, susScore } from "@/lib/study/instruments";
import {
  formatCountdown,
  nextPhase,
  parseSettings,
  previousPhase,
  secondsLeft,
  seededShuffle,
} from "@/lib/study/types";

describe("study phases", () => {
  it("steps through the workshop in order", () => {
    expect(nextPhase("lobby")).toBe("create");
    expect(nextPhase("review")).toBe("questionnaire");
    expect(nextPhase("done")).toBeNull();
    expect(previousPhase("answer")).toBe("create");
    expect(previousPhase("lobby")).toBeNull();
  });
});

describe("seededShuffle", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("is stable per seed and keeps every item", () => {
    const once = seededShuffle(items, "participant-1");
    expect(seededShuffle(items, "participant-1")).toEqual(once);
    expect([...once].sort()).toEqual(items);
  });

  it("differs between participants", () => {
    const orders = new Set(
      ["p1", "p2", "p3", "p4"].map((seed) => seededShuffle(items, seed).join("")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("countdown", () => {
  it("corrects for the server clock", () => {
    const now = Date.parse("2026-10-21T10:00:00Z");
    // Server is 5 s ahead of this client
    expect(secondsLeft("2026-10-21T10:01:00Z", 5_000, now)).toBe(55);
    expect(secondsLeft(null, 0, now)).toBeNull();
  });

  it("formats overtime with a minus sign", () => {
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(-61)).toBe("−1:01");
  });
});

describe("parseSettings", () => {
  it("falls back to safe defaults", () => {
    expect(parseSettings(null)).toEqual({ allowVoice: false, findingsMinResponses: 3 });
    expect(parseSettings({ allowVoice: true, findingsMinResponses: 0 })).toEqual({
      allowVoice: true,
      findingsMinResponses: 3,
    });
  });
});

describe("final questionnaire", () => {
  it("has unique field names and every field in a section", () => {
    const names = FINAL_QUESTIONNAIRE.fields.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    const sectioned = FINAL_QUESTIONNAIRE.groups.flatMap((g) => g.fieldIds);
    expect(sectioned.sort()).toEqual(FINAL_QUESTIONNAIRE.fields.map((f) => f.id).sort());
  });

  it("scores SUS (odd items positive, even items negative)", () => {
    const best = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`sus_${i + 1}`, i % 2 === 0 ? 5 : 1]),
    );
    expect(susScore(best)).toBe(100);
    const neutral = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`sus_${i + 1}`, 3]),
    );
    expect(susScore(neutral)).toBe(50);
    expect(susScore({ sus_1: 5 })).toBeNull();
  });
});

describe("export CSVs", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(toCsv(["a", "b"], [['say "hi"', "x,y\nz"]])).toBe(
      'a,b\n"say ""hi""","x,y\nz"\n',
    );
  });

  const data = {
    exportedAt: "2026-10-21T12:00:00Z",
    participants: [
      { id: "p1", display_name: "Ana", portfolio_id: "f1" },
    ],
    events: [
      {
        id: 1,
        created_at: "2026-10-21T11:00:00Z",
        client_at: null,
        participant_id: "p1",
        phase: "create",
        type: "probe_answered",
        portfolio_id: "f1",
        payload: { option: "weekly" },
      },
      {
        id: 2,
        created_at: "2026-10-21T11:05:00Z",
        client_at: null,
        participant_id: null,
        phase: "answer",
        type: "phase_changed",
        portfolio_id: null,
        payload: {},
      },
    ],
    questionnaires: [
      {
        participant_id: "p1",
        instrument: "final",
        submitted_at: "2026-10-21T11:50:00Z",
        answers: { sus_1: 4, refine_changes: "Split the budget question" },
      },
    ],
  } as unknown as StudyExport;

  it("names participants and the facilitator in the event log", () => {
    const lines = eventsCsv(data).trim().split("\n");
    expect(lines[1]).toContain(",Ana,create,probe_answered,f1,");
    expect(lines[2]).toContain(",facilitator,answer,phase_changed,");
  });

  it("puts every questionnaire item in its own column", () => {
    const [header, row] = questionnaireCsv(data).trim().split("\n");
    expect(header.split(",")).toHaveLength(4 + FINAL_QUESTIONNAIRE.fields.length);
    expect(row.startsWith("Ana,final,")).toBe(true);
    expect(row).toContain("Split the budget question");
  });
});
