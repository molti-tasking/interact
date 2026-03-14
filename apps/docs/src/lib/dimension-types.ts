/**
 * A dimension scope describes what conceptual area a dimension addresses.
 *
 * - context:     Who / where / when — situational factors
 * - measurement: What to capture and how to quantify it
 * - preference:  Subjective choices, priorities, opinions
 * - constraint:  Rules, limits, boundaries, compliance requirements
 */
export type DimensionScope =
  | "context"
  | "measurement"
  | "preference"
  | "constraint";

export type DimensionStatus = "suggested" | "accepted" | "rejected" | "edited";
export type DimensionSource = "system" | "user" | "opinion";

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
}

export interface DimensionEdit {
  timestamp: string;
  field: "name" | "description" | "importance" | "scope" | "openQuestions" | "status";
  oldValue: unknown;
  newValue: unknown;
}

export interface DimensionSuggestion {
  dimensions: DimensionObject[];
  reasoning: string;
  prompt: string;
  generatedAt: string;
}

export const dimensionScopeColors: Record<DimensionScope, string> = {
  context: "bg-sky-100 text-sky-700 border-sky-200",
  measurement: "bg-violet-100 text-violet-700 border-violet-200",
  preference: "bg-amber-100 text-amber-700 border-amber-200",
  constraint: "bg-rose-100 text-rose-700 border-rose-200",
};

export const dimensionScopeLabels: Record<DimensionScope, string> = {
  context: "Context",
  measurement: "Measurement",
  preference: "Preference",
  constraint: "Constraint",
};

export function createDimensionObject(
  overrides: Partial<DimensionObject> & Pick<DimensionObject, "name">,
): DimensionObject {
  return {
    id: `dim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "",
    importance: "",
    scope: "context",
    openQuestions: [],
    status: "suggested",
    source: "system",
    isActive: true,
    parentDimensionId: null,
    createdAt: new Date().toISOString(),
    editHistory: [],
    ...overrides,
  };
}
