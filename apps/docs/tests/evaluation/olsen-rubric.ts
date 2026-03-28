/**
 * Olsen's "Evaluating User Interface Systems Research" criteria.
 *
 * We evaluate a focused subset of 4 criteria most relevant to
 * lazy data space elicitation and the Malleable Forms contribution.
 *
 * Reference: Olsen, D.R. (2007). Evaluating User Interface Systems Research.
 *            Proc. UIST '07, pp. 251–258.
 */

export interface OlsenCriterion {
  id: string;
  name: string;
  /** Olsen's original definition of this criterion */
  description: string;
  /** What to look for when evaluating our system against this criterion */
  evaluationFocus: string;
  /** 5-point scale anchors specific to our system context */
  anchors: {
    1: string;
    2: string;
    3: string;
    4: string;
    5: string;
  };
}

export const olsenCriteria: OlsenCriterion[] = [
  {
    id: "expressive-match",
    name: "Expressive Match",
    description:
      "The degree to which the system's notation aligns with the problem " +
      "domain, reducing the cognitive distance between design intent and " +
      "system representation. A system with good expressive match lets users " +
      "work in terms natural to their problem rather than in terms of the " +
      "underlying technology.",
    evaluationFocus:
      "Does the creator work in natural language (their domain language) " +
      "rather than JSON schemas or database notation? Do design probes use " +
      "domain-specific terminology? Does the system surface domain standards " +
      "(OSHA, HIPAA) by name? Is the structured intent format " +
      "(Purpose/Audience/Constraints) a natural way to describe a form?",
    anchors: {
      1: "Creator must work entirely in technical schema notation (field types, keys, constraints) with no domain language support",
      2: "Some natural language input accepted but output is purely technical; significant mental translation required",
      3: "Natural language used for initial input but the system responds in technical terms; design probes are generic",
      4: "Good domain mapping — natural language intent, domain-aware design probes and standards detection, but generated schema still requires technical understanding to verify",
      5: "Excellent match — creator works entirely in domain language throughout; system translates to technical representation automatically; standards referenced by domain name; design probes phrased in domain terms",
    },
  },
  {
    id: "expressive-leverage",
    name: "Expressive Leverage",
    description:
      "The ratio of expressible outcomes to the number of choices the user " +
      "must make. High leverage means a single user action produces many " +
      "useful results. This is achieved through abstraction, generalization, " +
      "and intelligent defaults.",
    evaluationFocus:
      "How many fields does a single intent paragraph generate? " +
      "Does one design probe resolution update both intent AND schema simultaneously? " +
      "Does accepting a domain standard add multiple fields at once? " +
      "How much specification is amplified by the Smart Pipeline's " +
      "dimension discovery and design probe generation?",
    anchors: {
      1: "No leverage — each field must be individually specified with type, label, validation, and constraints; 1:1 ratio of effort to output",
      2: "Minimal leverage — templates or copy-paste reduce some repetition but most fields require individual configuration",
      3: "Moderate leverage — system generates fields from description but each requires manual review and correction; design choices have limited propagation",
      4: "Good leverage — one intent paragraph generates 20-30 fields; design probes update both intent and schema; standards add multiple fields; some manual adjustment still needed",
      5: "Excellent leverage — single natural language description produces complete, validated form schema; each design probe resolution propagates changes across all layers; standards compliance achieved with one accept action; minimal manual intervention",
    },
  },
  {
    id: "flexibility",
    name: "Flexibility",
    description:
      "The ability to make rapid design changes that can then be evaluated. " +
      "A flexible tool allows quick exploration of alternatives without " +
      "requiring the creator to start over or perform extensive rework.",
    evaluationFocus:
      "Can the creator edit intent and regenerate without losing resolved " +
      "design probes? Is there a prompt-edit mode for quick what-if changes? " +
      "Can design probes be dismissed and regenerated? " +
      "Does the system support iterative refinement (add constraints, " +
      "change audience) without rebuilding the entire schema?",
    anchors: {
      1: "No flexibility — any change requires starting from scratch; no iterative refinement possible",
      2: "Limited flexibility — can edit individual fields but changing the overall design requires regeneration which resets all progress",
      3: "Moderate flexibility — intent edits trigger partial regeneration; some design probe history preserved; manual adjustments may be lost",
      4: "Good flexibility — intent freely editable; design probes dismissable and regenerable; prompt-edit mode for targeted changes; schema refinement builds on existing work",
      5: "Excellent flexibility — full iterative refinement; intent, probes, and schema all independently editable; prompt-edit for experiments; Smart Pipeline detects which sections changed and runs only necessary steps; resolved probes and provenance preserved across iterations",
    },
  },
  {
    id: "reducing-skill-barrier",
    name: "Reducing Skill Barrier",
    description:
      "The degree to which the system empowers users who previously could " +
      "not perform the task, or could only do so with great difficulty. " +
      "A good system makes previously difficult tasks accessible to a " +
      "broader population.",
    evaluationFocus:
      "Can a non-technical user (e.g., clinic administrator) create a " +
      "well-structured form schema without understanding data types, " +
      "validation rules, or database design? Do design probes guide " +
      "domain decisions without requiring technical knowledge? " +
      "Does the system produce comparable quality output regardless of " +
      "creator skill level?",
    anchors: {
      1: "No skill barrier reduction — requires full understanding of data modeling, field types, validation, and schema design",
      2: "Minor reduction — simplified interface but still requires significant technical knowledge to produce quality forms",
      3: "Moderate reduction — non-technical users can create basic forms but complex requirements (validation, dependencies, compliance) require technical help",
      4: "Good reduction — non-technical users guided through complex decisions via design probes in plain language; domain standards handled automatically; main barrier is knowing what data to collect",
      5: "Excellent reduction — skill level affects only the specificity of the initial intent; system provides equal quality scaffolding for novice and expert; design probes, standards detection, and conflict resolution make technical decisions accessible to all",
    },
  },
];

/**
 * Build the Olsen judging prompt for a specific criterion.
 */
export function buildOlsenJudgingPrompt(
  criterion: OlsenCriterion,
  systemDescription: string,
): string {
  return `You are an expert evaluator of user interface systems research, applying Dan Olsen's evaluation framework from "Evaluating User Interface Systems Research" (UIST 2007).

You are evaluating a system called "Malleable Forms" — a web-based toolkit for conversational form creation using large language models. The system implements "lazy data space elicitation," where creators discover their data schema through a structured conversational process rather than specifying it upfront.

## System Description
${systemDescription}

## Evaluation Criterion: ${criterion.name}

### Definition (Olsen, 2007)
${criterion.description}

### What to Evaluate
${criterion.evaluationFocus}

## Scoring Scale (1-5)
HIGHER is better for this criterion.

1: ${criterion.anchors[1]}
2: ${criterion.anchors[2]}
3: ${criterion.anchors[3]}
4: ${criterion.anchors[4]}
5: ${criterion.anchors[5]}

## Instructions
1. First, cite 2-4 specific capabilities or design decisions from the system description that are relevant to ${criterion.name}. Reference concrete features, not vague claims.
2. For each observation, explain how it contributes to or detracts from ${criterion.name}.
3. Assign a score from 1-5 based on the anchors above. Use the FULL range — do not default to 4. A score of 5 means the system exemplifies this criterion; a score of 1-2 means it fails to address it.
4. Provide a 2-3 sentence justification referencing the anchor description for your chosen score.

Return ONLY valid JSON:
{
  "observations": ["observation 1 with specific evidence", "observation 2 with specific evidence"],
  "score": 4,
  "justification": "Explanation referencing the anchor for the chosen score."
}`;
}
