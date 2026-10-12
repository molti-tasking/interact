/**
 * A dimension scope describes what conceptual area a dimension addresses.
 *
 * - context:     Who / where / when — situational factors
 * - measurement: What to capture and how to quantify it
 * - preference:  Subjective choices, priorities, design probes
 * - constraint:  Rules, limits, boundaries, compliance requirements
 */
export type DimensionScope =
  | "context"
  | "measurement"
  | "preference"
  | "constraint";

export type DimensionStatus = "suggested" | "accepted" | "rejected" | "edited";
export type DimensionSource = "system" | "user" | "design_probe" | "standard";

export interface DimensionObject {
  id: string;
  name: string;
  description: string;
  /** Why this dimension matters for the form's design */
  importance: string;
  /** Conceptual area this dimension belongs to */
  scope: DimensionScope;
  /** Ambiguities / questions the user should consider before field-level design */
  openQuestions: string[];
  status: DimensionStatus;
  source: DimensionSource;
  isActive: boolean;
  parentDimensionId: string | null;
  createdAt: string;
  editHistory: DimensionEdit[];
  /** ID of the domain standard this dimension originated from, if any */
  standardId?: string;
}

export interface DimensionEdit {
  timestamp: string;
  field:
    | "name"
    | "description"
    | "importance"
    | "scope"
    | "openQuestions"
    | "status";
  oldValue: unknown;
  newValue: unknown;
}

export interface DimensionSuggestion {
  dimensions: DimensionObject[];
  reasoning: string;
  prompt: string;
  generatedAt: string;
}



