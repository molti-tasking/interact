// @vitest-environment node
/**
 * The local study's mock assistant (STUDY_MOCK_LLM=1): answers by turn, says
 * that it is a mock, and after its recorded conversation keeps saying how to
 * reach the real model instead of starting over.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixture, resetFixtureState } from "@/lib/testing/fixture-loader";

type Turn = { success: boolean; result: { reply: string; schemaPatch: unknown } };

describe("study-local mock assistant", () => {
  beforeEach(() => {
    process.env.FIXTURE_SCENARIO = "study-local";
    resetFixtureState();
  });
  afterEach(() => {
    delete process.env.FIXTURE_SCENARIO;
    resetFixtureState();
  });

  const turn = (n: number, prompt = "anything") =>
    loadFixture<Turn>("assistantTurn", {}, { prompt, turn: n }).result;

  it("answers each recorded turn, marked as a mock", () => {
    expect(turn(1).schemaPatch).toBeNull();
    expect(turn(2).schemaPatch).not.toBeNull();
    expect(turn(3).schemaPatch).not.toBeNull();
    for (const n of [1, 2, 3, 4]) expect(turn(n).reply).toMatch(/^\(Mock answer\)/);
  });

  it("after the recorded conversation, explains instead of starting over", () => {
    for (const n of [4, 5, 9]) {
      expect(turn(n).schemaPatch).toBeNull();
      expect(turn(n).reply).toContain("STUDY_MOCK_LLM=0");
    }
  });
});
