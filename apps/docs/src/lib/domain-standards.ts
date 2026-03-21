import type { SchemaField } from "./schema-manager";

/**
 * A domain standard profile containing field constraints, code systems,
 * and export format information. These are curated static data — the LLM
 * cannot be trusted to recall standard specifics, so we inject them as context.
 */
export interface DomainStandard {
  /** Unique identifier, e.g. "fhir-patient-intake" */
  id: string;
  /** Human-readable name, e.g. "FHIR Patient Intake R4" */
  name: string;
  /** Domain category, e.g. "healthcare" */
  domain: string;
  /** Standard version */
  version: string;
  /** Short description of what this standard covers */
  description: string;
  /** Link to the specification */
  url: string;
  /** Keywords used for detection: ["patient", "intake", "clinical"] */
  keywords: string[];
  /** Field-level constraints defined by this standard */
  fieldConstraints: StandardFieldConstraint[];
  /** Controlled vocabularies / code systems */
  codeSystems: CodeSystem[];
  /** Supported export formats, e.g. ["fhir-questionnaire-json", "json-schema"] */
  exportFormats: string[];
}

/**
 * A single field constraint defined by a standard.
 * Maps to a concrete form field requirement.
 */
export interface StandardFieldConstraint {
  /** Unique key for this field within the standard */
  fieldKey: string;
  /** Human-readable label */
  label: string;
  /** Form field type */
  type: SchemaField["type"];
  /** How strongly the standard requires this field */
  required: "mandatory" | "recommended" | "optional";
  /** What this field captures and why */
  description: string;
  /** Reference to a code system for controlled values */
  codeSystemId?: string;
  /** Validation rules (mirrors SchemaField.validation) */
  validationRules?: SchemaField["validation"];
  /** Formal reference in the standard, e.g. "FHIR Patient.birthDate" */
  standardReference: string;
}

/**
 * A controlled vocabulary or code system referenced by field constraints.
 */
export interface CodeSystem {
  id: string;
  name: string;
  values: { code: string; display: string }[];
}

/**
 * Result of detecting which standards apply to a user's prompt.
 */
export interface DetectedStandard {
  standard: DomainStandard;
  /** Confidence score 0-1 based on keyword matching */
  confidence: number;
  /** Which keywords from the standard matched */
  matchedKeywords: string[];
  /** Constraints from this standard relevant to the prompt */
  relevantConstraints: StandardFieldConstraint[];
}
