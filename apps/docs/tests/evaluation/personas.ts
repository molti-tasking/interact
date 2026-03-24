/**
 * Persona definitions for CDN evaluation.
 *
 * Each persona represents a different skill level and domain expertise.
 * They make different choices when presented with opinion cards,
 * simulating the range of users Malleable Forms targets.
 */

export interface Persona {
  id: string;
  name: string;
  role: string;
  skillLevel: "novice" | "intermediate" | "expert";
  description: string;
  /** How this persona approaches opinion questions — fed to LLM for decision-making */
  decisionStyle: string;
}

export const personas: Persona[] = [
  {
    id: "clinic-admin",
    name: "Sara",
    role: "Clinic Administrator",
    skillLevel: "novice",
    description:
      "Non-technical clinic administrator who needs forms for patient intake. " +
      "No programming or database experience. Uses Google Forms occasionally.",
    decisionStyle:
      "Prefers simple, practical options. Avoids technical jargon. " +
      "Tends to include more fields rather than fewer (worried about missing data). " +
      "Accepts standard/compliance recommendations readily.",
  },
  {
    id: "ux-researcher",
    name: "Jordan",
    role: "UX Researcher",
    skillLevel: "intermediate",
    description:
      "UX researcher with survey design experience. " +
      "Understands data types and form flow but not database schemas. " +
      "Has used Typeform, SurveyMonkey, and Qualtrics extensively.",
    decisionStyle:
      "Focuses on respondent experience. Prefers fewer, well-structured fields. " +
      "Cares about question ordering and progressive disclosure. " +
      "May skip optional compliance fields if they add friction.",
  },
  {
    id: "data-engineer",
    name: "Alex",
    role: "Data Engineer",
    skillLevel: "expert",
    description:
      "Technical data engineer building data collection pipelines. " +
      "Deep understanding of schemas, validation, normalization. " +
      "Wants precise control over field types and constraints.",
    decisionStyle:
      "Prefers strongly typed fields with validation. Wants enum/select over free text. " +
      "Removes redundant fields aggressively. Accepts all relevant standards. " +
      "May add constraints via prompt edit for edge cases.",
  },
];

export interface Scenario {
  id: string;
  name: string;
  paperLabel: string;
  title: string;
  intent: string;
}

export const scenarios: Scenario[] = [
  {
    id: "rental",
    name: "Construction Equipment Rental",
    paperLabel: "Rental",
    title: "Construction Equipment Rental Agreement",
    intent:
      "## Purpose\n" +
      "Create a rental agreement form for construction equipment. " +
      "Need to capture equipment details, rental period, pricing, " +
      "insurance requirements, and operator certification.\n\n" +
      "## Audience\n" +
      "Construction company managers renting heavy equipment " +
      "(excavators, cranes, bulldozers) from our fleet.\n\n" +
      "## Constraints\n" +
      "Must comply with OSHA equipment operation requirements. " +
      "Insurance documentation is mandatory.",
  },
  {
    id: "fitness",
    name: "Fitness Coaching Client Intake",
    paperLabel: "Fitness",
    title: "Fitness Coaching Client Intake",
    intent:
      "## Purpose\n" +
      "Collect intake information from new fitness coaching clients " +
      "including their health history, fitness goals, and availability.\n\n" +
      "## Audience\n" +
      "New clients signing up for personal training or group fitness coaching.\n\n" +
      "## Exclusions\n" +
      "Do not collect detailed medical records — only relevant health conditions " +
      "that affect exercise safety.",
  },
  {
    id: "orthopedic",
    name: "Orthopedic Patient Records",
    paperLabel: "Orthopedic",
    title: "Orthopedic Patient Intake Form",
    intent:
      "## Purpose\n" +
      "Create a patient intake form for our orthopedic clinic " +
      "with insurance details and medical history focused on " +
      "musculoskeletal conditions.\n\n" +
      "## Audience\n" +
      "Patients visiting the orthopedic clinic for the first time.\n\n" +
      "## Constraints\n" +
      "Must capture insurance provider and policy details. " +
      "Pain assessment using a standardized scale is required.",
  },
];
