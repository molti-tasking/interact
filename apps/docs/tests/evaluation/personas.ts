/**
 * Persona definitions for CDN evaluation.
 *
 * Each persona represents a different skill level and domain expertise.
 * They make different choices when presented with design probe cards,
 * simulating the range of users Malleable Forms targets.
 */

export interface Persona {
  id: string;
  name: string;
  role: string;
  skillLevel: "novice" | "intermediate" | "expert";
  description: string;
  /** How this persona approaches design probe questions — fed to LLM for decision-making */
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
    id: "wholesaler-order",
    name: "Paper Wholesaler Order Form",
    paperLabel: "Order",
    title: "Client Order Form",
    intent:
      "## Purpose\n" +
      "I need a client order form for our paper and office supply wholesale business. " +
      "We use volume-based pricing with quantity breaks at 10, 50, and 100 cases. " +
      "Products include copy paper, cardstock, envelopes, binders, pens and markers, and toner.\n\n" +
      "## Audience\n" +
      "Regional manager, office administrator, sales representatives.\n\n" +
      "## Constraints\n" +
      "Products should be identified using GS1 GTINs. " +
      "Tax-exempt status should be stored as a client-level default with per-order override.",
  },
  {
    id: "sales-rep-hiring",
    name: "Sales Rep Job Application",
    paperLabel: "Hiring",
    title: "Job Application — Sales Representative",
    intent:
      "## Purpose\n" +
      "I need a job application form for a new sales representative. " +
      "We want to capture applicant details, sales experience, industry background, " +
      "CRM proficiency, territory willingness, and communication skills.\n\n" +
      "## Audience\n" +
      "Job applicants responding to a sales representative posting.\n\n" +
      "## Constraints\n" +
      "Should use Schema.org/JobPosting vocabulary for machine-readable output. " +
      "Include self-assessment fields for communication and customer orientation.",
  },
  {
    id: "quarterly-review",
    name: "Quarterly Business Review",
    paperLabel: "QBR",
    title: "Quarterly Business Review",
    intent:
      "## Purpose\n" +
      "I need a quarterly business review form covering all our sales, " +
      "operations, and financial data for three audiences: sales reps, " +
      "warehouse operations, and corporate oversight.\n\n" +
      "## Audience\n" +
      "Regional manager, sales representatives, warehouse foreman, corporate supervisor.\n\n" +
      "## Constraints\n" +
      "Must support derived views for different roles with fundamentally different " +
      "information needs. Revenue and expense categories should follow consistent taxonomy.",
  },
];
