/**
 * CDN (Cognitive Dimensions of Notations) rubric definitions.
 *
 * Each dimension is operationalized as a structured evaluation prompt
 * with a 5-point scale and descriptive anchors per the paper methodology.
 *
 * Reference: Green & Petre (1996), Blackwell et al. (2001)
 */

export interface CDNDimension {
  id: string;
  name: string;
  /** Lower is better for some dimensions */
  lowerIsBetter: boolean;
  description: string;
  /** What to look for in the artifacts */
  evaluationFocus: string;
  /** Descriptive anchors for the 5-point scale */
  anchors: {
    1: string;
    2: string;
    3: string;
    4: string;
    5: string;
  };
}

export const cdnDimensions: CDNDimension[] = [
  {
    id: "viscosity",
    name: "Viscosity",
    lowerIsBetter: true,
    description:
      "Resistance to change. How much effort is required to make a single change to the form design?",
    evaluationFocus:
      "Look at how intent edits propagate to schema changes. " +
      "Count the steps needed to add/remove/modify a field. " +
      "Check if design probe resolutions automatically update both intent and schema.",
    anchors: {
      1: "Changes require a single action (e.g., answer one design probe) and propagate automatically to all layers",
      2: "Most changes are low-effort with automatic propagation; occasional manual adjustment needed",
      3: "Moderate effort — some changes propagate, others require explicit regeneration",
      4: "Significant manual work to make changes; limited automatic propagation",
      5: "Every change requires manual editing of multiple artifacts; no automatic propagation",
    },
  },
  {
    id: "premature-commitment",
    name: "Premature Commitment",
    lowerIsBetter: true,
    description:
      "Are users forced to make decisions before they have enough information?",
    evaluationFocus:
      "Check if the system requires upfront schema specification. " +
      "Look at whether the creator can express vague intent first and refine later. " +
      "Examine if design probes allow deferring decisions.",
    anchors: {
      1: "Creator can start with vague intent; all decisions can be deferred or revised; system guides incrementally",
      2: "Minimal upfront commitment; most decisions are reversible through intent editing",
      3: "Some early decisions are required but can be changed later with moderate effort",
      4: "Several decisions must be made upfront; changing them later requires significant rework",
      5: "Full schema must be specified upfront; changes require starting over",
    },
  },
  {
    id: "progressive-evaluation",
    name: "Progressive Evaluation",
    lowerIsBetter: false,
    description:
      "Can users check their work at any point during the design process?",
    evaluationFocus:
      "Check for live form preview alongside intent editing. " +
      "Look for intermediate feedback (dimension badges, design probe cards, field count). " +
      "Can the creator see the form at every stage of the process?",
    anchors: {
      1: "No feedback until the entire process is complete",
      2: "Limited feedback available only after explicit generation steps",
      3: "Some intermediate feedback (e.g., field list) but no live preview",
      4: "Good intermediate feedback with live preview; minor delays between changes and updates",
      5: "Continuous, real-time feedback at every stage — live preview, dimension badges, design probe status, field count all update immediately",
    },
  },
  {
    id: "hidden-dependencies",
    name: "Hidden Dependencies",
    lowerIsBetter: true,
    description:
      "Are there relationships between components that are not visible to the user?",
    evaluationFocus:
      "Check provenance logging — can the creator trace why a field exists? " +
      "Look at design-probe-to-schema connections. " +
      "Are dimension-to-field mappings visible? Are standard requirements traceable?",
    anchors: {
      1: "All dependencies are explicitly visible — provenance log traces every field origin, design probe resolutions show impact, dimension-field mappings are clear",
      2: "Most dependencies visible through provenance; a few implicit connections exist",
      3: "Some dependencies visible but others require investigation to understand",
      4: "Many hidden dependencies — unclear why fields exist or how changes propagate",
      5: "Completely opaque — no traceability between intent, design probes, dimensions, and schema",
    },
  },
  {
    id: "visibility",
    name: "Visibility",
    lowerIsBetter: false,
    description:
      "Can the user easily see all relevant information, or is it hidden behind navigation?",
    evaluationFocus:
      "Check the workspace layout — are intent, design probes, standards, and form preview all visible simultaneously? " +
      "Is the resolved design probe history accessible? " +
      "Can all schema fields be seen at once?",
    anchors: {
      1: "Critical information is hidden behind multiple clicks or separate pages",
      2: "Some information visible but important elements require navigation",
      3: "Main workspace shows intent and preview; secondary information requires scrolling or expanding",
      4: "Good visibility — intent, design probes, standards, and preview mostly visible; resolved history accessible on demand",
      5: "Excellent visibility — all layers (intent, design probes, dimensions, standards, schema, preview) visible or one click away in a coherent workspace",
    },
  },
  {
    id: "closeness-of-mapping",
    name: "Closeness of Mapping",
    lowerIsBetter: false,
    description:
      "How closely does the notation correspond to the problem domain?",
    evaluationFocus:
      "Check if the creator works in natural language (their domain language) rather than schema notation. " +
      "Are design probes phrased in domain terms? " +
      "Does the system use domain-specific standards (OSHA, medical)?",
    anchors: {
      1: "Creator must work in technical schema notation with no domain mapping",
      2: "Mix of technical and domain language; some translation required",
      3: "Domain language used for input but output shown in technical terms",
      4: "Good domain mapping — natural language intent, domain-aware design probes, but schema still somewhat technical",
      5: "Excellent domain mapping — creator works entirely in domain language; system handles all technical translation; standards referenced by domain name",
    },
  },
  {
    id: "role-expressiveness",
    name: "Role-Expressiveness",
    lowerIsBetter: false,
    description:
      "Can the user easily understand the purpose of each component?",
    evaluationFocus:
      "Check if fields have clear labels and descriptions. " +
      "Are design probe cards self-explanatory? " +
      "Do dimension badges convey their purpose? " +
      "Is the relationship between intent sections and generated fields clear?",
    anchors: {
      1: "Components are cryptic — field keys, types, and constraints have no human-readable explanation",
      2: "Some components labeled but purpose of many elements is unclear",
      3: "Main components are understandable but secondary elements (constraints, groups, tags) are opaque",
      4: "Good expressiveness — fields have labels+descriptions, design probes have explanations, dimensions are named",
      5: "Excellent — every component clearly communicates its purpose; layer badges, dimension names, design probe explanations, and field descriptions all contribute to understanding",
    },
  },
  {
    id: "provisionality",
    name: "Provisionality",
    lowerIsBetter: false,
    description:
      "Can the user sketch and explore tentatively, or must every action be definitive?",
    evaluationFocus:
      "Check if design probes can be dismissed (deferred). " +
      "Can intent be edited freely without losing the schema? " +
      "Is there a prompt-edit mode for quick what-if changes? " +
      "Can the creator regenerate/refine without starting over?",
    anchors: {
      1: "Every action is final — no way to explore tentatively or undo",
      2: "Limited provisionality — some actions reversible but exploration is difficult",
      3: "Moderate — can dismiss design probes and re-edit intent, but regeneration resets progress",
      4: "Good — design probes dismissable, intent editable, prompt-edit for experiments; refinement builds on existing schema",
      5: "Excellent — full provisional workflow; dismiss design probes, edit intent incrementally, prompt-edit experiments, regenerate preserves resolved probes, version history via provenance",
    },
  },
];

/**
 * Build the CDN judging prompt for a specific dimension and session artifacts.
 */
export function buildJudgingPrompt(
  dimension: CDNDimension,
  artifacts: SessionArtifacts,
): string {
  return `You are an expert HCI evaluator applying the Cognitive Dimensions of Notations (CDN) framework to assess an AI-assisted form design system called "Malleable Forms".

## System Description
Malleable Forms is a web-based form design tool with the following capabilities:
- **Intent Editor**: Users write natural language descriptions organized into structured sections (Purpose, Audience, Exclusions, Constraints). The markdown editor is always visible in the left panel.
- **Generation Pipeline**: When the user clicks "Generate Form", the pipeline detects which sections changed and runs only necessary steps (full generation, filter-only for exclusions, constraint recheck, or noop).
- **Domain Dimensions**: The system identifies domain dimensions (e.g., "Insurance Requirements", "Medical History") and shows them as badges.
- **Design Probes**: The system generates refinement questions (e.g., "Should we include previous surgeries?") with 2-4 options. Users click an option and the system updates both the intent AND the schema automatically. Cards can be dismissed (deferred). A "New questions" button regenerates design probes at any time.
- **Live Form Preview**: The right panel shows a real-time preview of the generated form, updating after each design probe resolution or intent change.
- **Standards Detection**: The system identifies relevant compliance standards (e.g., OSHA, HIPAA) and lets users accept or skip them.
- **Prompt Edit Mode**: A text input where users describe changes in natural language, applied without regenerating the full form.
- **Provenance Log**: Every action (intent change, design probe resolution, schema update) is logged with timestamps, diffs, and rationale. Accessible from the workspace.
- **Bidirectional Sync**: Field edits in the schema backpropagate to the intent description.
- **Schema Conflict Resolution**: Schema inconsistencies (duplicates, type mismatches) are detected and presented as auto-fix suggestions.
- **Resolved Design Probes Stack**: Answered design probes stack into a clickable summary that opens a grid dialog showing all decisions in order.

## Dimension: ${dimension.name}
${dimension.description}

## What to Evaluate
${dimension.evaluationFocus}

## Scoring Scale (1-5)
${dimension.lowerIsBetter ? "LOWER is better for this dimension." : "HIGHER is better for this dimension."}

1: ${dimension.anchors[1]}
2: ${dimension.anchors[2]}
3: ${dimension.anchors[3]}
4: ${dimension.anchors[4]}
5: ${dimension.anchors[5]}

## Session Artifacts

### Persona
Name: ${artifacts.persona.name}
Role: ${artifacts.persona.role}
Skill Level: ${artifacts.persona.skillLevel}
Description: ${artifacts.persona.description}

### Scenario
${artifacts.scenario.name}

### Initial Intent (as entered by persona)
${artifacts.initialIntent}

### Final Intent (after system refinement)
${artifacts.finalIntent}

### Design Probe Interactions (${artifacts.designProbes.length} total)
${artifacts.designProbes.map((o, i) => `${i + 1}. Q: "${o.text}" → A: "${o.selectedLabel}" [${o.status}]`).join("\n")}

### Final Schema (${artifacts.fieldCount} fields)
${artifacts.schemaDescription}

### Provenance Log (${artifacts.provenanceEntries} entries)
${artifacts.provenanceSummary}

## Instructions
1. First, cite 2-3 specific observations from the artifacts AND system capabilities that are relevant to ${dimension.name}.
2. Then assign a score from 1-5 based on the anchors above. Use the FULL range — do not default to 4. A score of 5 means the system exemplifies this dimension; a score of 1-2 means it performs poorly. Consider both the system's structural affordances AND how this specific persona experienced them.
3. Provide a brief (1-2 sentence) justification that references the anchor description for your chosen score.

Return ONLY valid JSON:
{
  "observations": ["observation 1", "observation 2"],
  "score": 4,
  "justification": "Brief explanation of score"
}`;
}

export interface SessionArtifacts {
  persona: {
    name: string;
    role: string;
    skillLevel: string;
    description: string;
  };
  scenario: {
    name: string;
  };
  initialIntent: string;
  finalIntent: string;
  designProbes: {
    text: string;
    selectedLabel: string;
    status: string;
  }[];
  fieldCount: number;
  schemaDescription: string;
  provenanceEntries: number;
  provenanceSummary: string;
}
