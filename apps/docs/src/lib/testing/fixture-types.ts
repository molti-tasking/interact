export interface FixtureEntry {
  actionName: string;
  callIndex: number;
  input: unknown;
  output: unknown;
  timestamp: string;
  matchHints?: {
    selectedOptionLabel?: string;
    prompt?: string;
    scenario?: string;
    /** A conversation's turn (1 = first message): the assistant arm's mock */
    turn?: number;
  };
}

export interface ScenarioMeta {
  scenario: string;
  description: string;
  portfolioTitle: string;
  steps: string[];
  recordedAt: string;
  /**
   * Reuse the recordings in turn instead of running out (the local study's
   * mock model, STUDY_MOCK_LLM=1): answers don't follow what was typed.
   */
  cycle?: boolean;
}
