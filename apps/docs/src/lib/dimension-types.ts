export type DimensionType = "categorical" | "ordinal" | "numerical" | "boolean";
export type DimensionStatus = "suggested" | "accepted" | "rejected" | "edited";
export type DimensionSource = "system" | "user" | "opinion";

export interface DimensionObject {
  id: string;
  name: string;
  description: string;
  type: DimensionType;
  values: string[];
  status: DimensionStatus;
  source: DimensionSource;
  isActive: boolean;
  parentDimensionId: string | null;
  schemaFieldKey?: string;
  createdAt: string;
  editHistory: DimensionEdit[];
}

export interface DimensionEdit {
  timestamp: string;
  field: "name" | "type" | "values" | "status";
  oldValue: unknown;
  newValue: unknown;
}

export interface DimensionSuggestion {
  dimensions: DimensionObject[];
  reasoning: string;
  prompt: string;
  generatedAt: string;
}

export const dimensionTypeColors: Record<DimensionType, string> = {
  categorical: "bg-violet-100 text-violet-700 border-violet-200",
  ordinal: "bg-amber-100 text-amber-700 border-amber-200",
  numerical: "bg-blue-100 text-blue-700 border-blue-200",
  boolean: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

/**
 * Maps dimension types to SchemaField types for form generation.
 */
export function mapDimensionTypeToFieldType(
  dimensionType: DimensionType,
): "string" | "number" | "boolean" | "select" {
  switch (dimensionType) {
    case "categorical":
      return "select";
    case "ordinal":
      return "select";
    case "numerical":
      return "number";
    case "boolean":
      return "boolean";
  }
}

export function createDimensionObject(
  overrides: Partial<DimensionObject> & Pick<DimensionObject, "name">,
): DimensionObject {
  return {
    id: `dim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "",
    type: "categorical",
    values: [],
    status: "suggested",
    source: "system",
    isActive: true,
    parentDimensionId: null,
    createdAt: new Date().toISOString(),
    editHistory: [],
    ...overrides,
  };
}
