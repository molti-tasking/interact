export interface FixtureEntry {
  actionName: string;
  callIndex: number;
  input: unknown;
  output: unknown;
  timestamp: string;
  matchHints?: {
    selectedOptionLabel?: string;
    prompt?: string;
  };
}

export interface ScenarioMeta {
  scenario: string;
  description: string;
  portfolioTitle: string;
  steps: string[];
  recordedAt: string;
}
