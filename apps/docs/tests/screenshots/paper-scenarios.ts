/**
 * The three scenarios of the paper, as database seeds: what a creator would
 * have on screen at each point of the walkthrough. No model is involved, so
 * the figures and the demo recording show the same content every run.
 *
 * Personas are the app's own demo users (`src/lib/mock-users.ts`).
 */

import {
  adds,
  changes,
  choice,
  field,
  intent,
  keeps,
  schemaOf,
  shown,
  type SeedField,
  type SeedHistory,
  type SeedPortfolio,
  type SeedQuestion,
} from "./helpers";

// ---------------------------------------------------------------------------
// Scenario 1 — youth soccer registration
// ---------------------------------------------------------------------------

const COACH = "Alex (Coach)";

export const SOCCER_ID = "a1000000-0001-4000-8000-000000000001";
export const SOCCER_ONE_LINE = "I need a registration form for our youth soccer club's new season";

const SOCCER_PURPOSE_BEFORE =
  "A registration form for our youth soccer club's new season. Parents register their child for one of the club's age groups (U8 to U14).";
const SOCCER_PURPOSE =
  "A registration form for our youth soccer club's new season. Parents register their child for one of the club's age groups (U8 to U14). The coaches need to know about allergies and medical conditions before the first training, and whom to call in an emergency.";

const soccerFirst: SeedField[] = [
  field("playerName", "Player's full name", { kind: "text" }, { required: true }),
  field("dateOfBirth", "Date of birth", { kind: "date" }, { required: true }),
  field("guardianName", "Parent or guardian", { kind: "text" }, { required: true }),
  field("guardianEmail", "Email", { kind: "text" }, { required: true }),
  field("guardianPhone", "Phone number", { kind: "text" }),
];
const ageGroup = field("ageGroup", "Age group", choice("U8", "U10", "U12", "U14"), {
  required: true,
  description: "By the child's age on 1 September",
});
const medical = field("medicalConditions", "Allergies or medical conditions", { kind: "text" }, {
  description: "Anything the coaches should know. Leave empty if none.",
});
const emergency = field("emergencyContact", "Emergency contact (name and phone)", { kind: "text" }, {
  required: true,
});
const jersey = field("jerseySize", "Jersey size", choice("Youth S", "Youth M", "Youth L", "Adult S"), {
  required: true,
});
const jerseyText = field("jerseySize", "Jersey size", { kind: "text" });
const photo = field("photoConsent", "Photos of my child may be used on the club website", {
  kind: "boolean",
});

export const soccer: SeedPortfolio = {
  id: SOCCER_ID,
  title: "Youth Soccer Registration",
  intent: intent(SOCCER_PURPOSE, "Parents of players aged 6 to 14"),
  schema: schemaOf([...soccerFirst.slice(0, 2), ageGroup, ...soccerFirst.slice(2), medical, emergency]),
};

/** The same form once it is in use (for the published form and the derivation) */
export const soccerPublished: SeedPortfolio = { ...soccer, status: "published" };

export const soccerQuestions: SeedQuestion[] = [
  {
    id: "c1000000-0001-4000-8000-000000000001",
    text: "Which age groups does the club run?",
    explanation: "Three of four drafts ask for an age group; they differ in how.",
    priority: 1,
    options: shown([1, 2, 0], [
      adds("fixedGroups", "U8, U10, U12 and U14", "Adds an age group choice", [ageGroup]),
      changes("fromBirthDate", "Work it out from the date of birth", "Explains what the date of birth is for", [
        { key: "dateOfBirth", description: "We use it to place your child in an age group." },
      ]),
      keeps(),
    ]),
    answer: "fixedGroups",
    by: COACH,
    minutesAgo: 24,
  },
  {
    id: "c1000000-0002-4000-8000-000000000002",
    text: "Collect medical information?",
    explanation: "Half of the drafts ask about allergies or conditions; the description doesn't say.",
    priority: 1,
    options: shown([2, 0, 1], [
      adds("allergiesAndConditions", "Allergies and conditions, plus an emergency contact", "Adds two fields", [medical, emergency]),
      adds("emergencyOnly", "Only an emergency contact", "Adds an emergency contact", [emergency]),
      keeps(),
    ]),
    answer: "allergiesAndConditions",
    by: COACH,
    minutesAgo: 19,
  },
  {
    id: "c1000000-0003-4000-8000-000000000003",
    text: "How is the season fee paid?",
    priority: 2,
    options: shown([0, 2, 1], [
      adds("payOnline", "Ask how the family wants to pay", "Adds a payment method choice", [
        field("paymentMethod", "Payment method", choice("Bank transfer", "Cash at the first training")),
      ]),
      adds("confirmFee", "A checkbox confirming the fee", "Adds a confirmation", [
        field("feeConfirmed", "I will pay the season fee of €60", { kind: "boolean" }, { required: true }),
      ]),
      keeps(),
    ]),
    // Declining is an answer: the treasurer handles fees separately
    answer: "keepAsIs",
    by: COACH,
    minutesAgo: 15,
  },
  {
    id: "c1000000-0004-4000-8000-000000000004",
    text: "Ask for a jersey size?",
    explanation: "Two of four drafts include a jersey size; the club orders kits before the season.",
    priority: 1,
    options: shown([1, 3, 0, 2], [
      adds("youthSizes", "Yes, as a choice of sizes", "Adds a jersey size choice", [jersey]),
      adds("freeText", "Yes, as free text", "Adds a jersey size text field", [jerseyText]),
      adds("sizeAndNumber", "Size and preferred shirt number", "Adds two fields", [
        jersey,
        field("shirtNumber", "Preferred shirt number", { kind: "number" }),
      ]),
      keeps(),
    ]),
  },
  {
    id: "c1000000-0005-4000-8000-000000000005",
    text: "Ask for photo consent?",
    priority: 2,
    options: shown([0, 2, 1], [
      adds("websiteConsent", "Yes, for the club website", "Adds a consent checkbox", [photo]),
      changes("requirePhone", "No, but make the phone number required", "Phone number becomes required", [
        { key: "guardianPhone", required: true },
      ]),
      keeps(),
    ]),
  },
  {
    id: "c1000000-0006-4000-8000-000000000006",
    text: "Has the child played in a club before?",
    priority: 3,
    options: shown([1, 0], [
      adds("previousClub", "Ask for the previous club", "Adds a previous club field", [
        field("previousClub", "Previous club (if any)", { kind: "text" }),
      ]),
      keeps(),
    ]),
  },
];

export const soccerHistory: SeedHistory[] = [
  {
    layer: "intent",
    action: "intent_updated",
    actor: COACH,
    rationale: "Described the form to create",
    minutesAgo: 31,
  },
  {
    layer: "configuration",
    action: "schema_generated",
    actor: COACH,
    rationale: "Generated 5 fields from intent",
    minutesAgo: 30,
    added: soccerFirst,
  },
  {
    layer: "dimensions",
    action: "design_probe_resolved",
    actor: COACH,
    rationale: '"Which age groups does the club run?" → "U8, U10, U12 and U14"',
    minutesAgo: 24,
    added: [ageGroup],
  },
  {
    layer: "intent",
    action: "intent_synced_from_edit",
    actor: "system",
    rationale: "Purpose updated after design decisions: age groups U8 to U14",
    minutesAgo: 23,
    previousPurpose: SOCCER_ONE_LINE,
  },
  {
    layer: "dimensions",
    action: "design_probe_resolved",
    actor: COACH,
    rationale: '"Collect medical information?" → "Allergies and conditions, plus an emergency contact"',
    minutesAgo: 19,
    added: [medical, emergency],
  },
  {
    layer: "intent",
    action: "intent_synced_from_edit",
    actor: "system",
    rationale: "Purpose updated after design decisions: medical information and emergency contact",
    minutesAgo: 18,
    previousPurpose: SOCCER_PURPOSE_BEFORE,
  },
  {
    layer: "dimensions",
    action: "design_probe_resolved",
    actor: COACH,
    rationale: '"How is the season fee paid?" → "Keep the form as it is"',
    minutesAgo: 15,
  },
];

// ---------------------------------------------------------------------------
// Scenario 2 — hiring a sales representative
// ---------------------------------------------------------------------------

const FOUNDER = "Sarah (Founder)";

export const HIRING_ID = "a2000000-0001-4000-8000-000000000001";
/** What the co-founder writes into "Generate questions" */
export const HIRING_FEEDBACK =
  "From James: we keep interviewing people who have never sold to restaurants or cafés. Can we find out earlier whether applicants know our industry?";

const industry = field(
  "industryBackground",
  "Industry Background",
  choice("Restaurants and cafés", "Food wholesale", "Other B2B sales", "No sales experience yet"),
  { required: true, description: "Where have you sold before? Choose the closest." },
);
const hiringFields: SeedField[] = [
  field("fullName", "Full name", { kind: "text" }, { required: true }),
  field("email", "Email", { kind: "text" }, { required: true }),
  field("phone", "Phone number", { kind: "text" }),
  field("yearsInSales", "Years in sales", { kind: "number" }, { required: true }),
  industry,
  field("drivingLicence", "I have a driving licence", { kind: "boolean" }, { required: true }),
  field("earliestStart", "Earliest start date", { kind: "date" }),
  field("coverLetter", "Why do you want to sell for us?", { kind: "text" }, {
    description: "Optional. A few sentences are enough.",
  }),
];

export const hiring: SeedPortfolio = {
  id: HIRING_ID,
  title: "Job Application — Sales Representative",
  intent: intent(
    "An application form for a sales representative at our coffee roastery. They visit restaurants and cafés in the region. We want to see early whether an applicant knows our industry, and we don't want to scare off good people with a long form.",
    "Applicants; read by both founders",
  ),
  schema: schemaOf(hiringFields),
};

export const hiringQuestions: SeedQuestion[] = [
  {
    id: "c2000000-0001-4000-8000-000000000001",
    text: "Ask about industry background?",
    explanation: "Raised by the feedback: whether applicants have sold to restaurants or cafés.",
    source: "llm",
    priority: 1,
    options: shown([2, 0, 1], [
      adds("asChoice", "Yes, as a choice of industries", "Adds an industry background choice", [industry]),
      adds("asText", "Yes, in the applicant's own words", "Adds an industry background text field", [
        field("industryBackground", "Industry Background", { kind: "text" }),
      ]),
      keeps(),
    ]),
    answer: "asChoice",
    by: FOUNDER,
    minutesAgo: 12,
  },
  {
    id: "c2000000-0002-4000-8000-000000000002",
    text: "Require a cover letter?",
    source: "llm",
    priority: 2,
    options: shown([1, 0, 2], [
      changes("optional", "Keep it, but optional", "Cover letter becomes optional", [
        { key: "coverLetter", required: false, description: "Optional. A few sentences are enough." },
      ]),
      adds("twoQuestions", "Replace it with two short questions", "Adds two short questions", [
        field("whyUs", "Why our roastery?", { kind: "text" }),
        field("bestSale", "Your best sale so far", { kind: "text" }),
      ]),
      keeps(),
    ]),
    answer: "optional",
    by: FOUNDER,
    minutesAgo: 9,
  },
  {
    id: "c2000000-0003-4000-8000-000000000003",
    text: "Ask for a reference from a former customer?",
    source: "llm",
    priority: 2,
    options: shown([0, 2, 1], [
      adds("oneReference", "One reference, name and phone", "Adds a customer reference", [
        field("customerReference", "A former customer we may call (name and phone)", { kind: "text" }),
      ]),
      adds("onRequest", "Only whether they can provide one", "Adds a yes/no question", [
        field("canProvideReference", "I can name a former customer as a reference", { kind: "boolean" }),
      ]),
      keeps(),
    ]),
  },
  {
    id: "c2000000-0004-4000-8000-000000000004",
    text: "Ask which region they can cover?",
    source: "llm",
    priority: 3,
    options: shown([1, 0], [
      adds("regions", "Yes, as a choice of regions", "Adds a region choice", [
        field("region", "Region you can cover", choice("City", "North", "South", "Anywhere")),
      ]),
      keeps(),
    ]),
  },
];

export const hiringHistory: SeedHistory[] = [
  {
    layer: "configuration",
    action: "schema_generated",
    actor: FOUNDER,
    rationale: "Generated 7 fields from intent",
    minutesAgo: 40,
    added: hiringFields.filter((f) => f !== industry),
  },
  {
    layer: "dimensions",
    action: "design_probe_resolved",
    actor: FOUNDER,
    rationale: '"Ask about industry background?" → "Yes, as a choice of industries"',
    minutesAgo: 12,
    added: [industry],
  },
  {
    layer: "dimensions",
    action: "design_probe_resolved",
    actor: FOUNDER,
    rationale: '"Require a cover letter?" → "Keep it, but optional"',
    minutesAgo: 9,
    modified: [
      {
        fieldId: "f-coverLetter",
        before: { required: true },
        after: { required: false, description: "Optional. A few sentences are enough." },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Scenario 3 — orthopedic patient records
// ---------------------------------------------------------------------------

const INFORMATICS = "Chen (Clinical Informatics Lead)";
const SURGEON = "Dr. Park (Lead Orthopedic Surgeon)";
const PHYSIO = "Lena (Physiotherapist)";

export const ORTHO_ID = "a3000000-0001-4000-8000-000000000001";
export const ORTHO_SURGEON_ID = "a3000000-0002-4000-8000-000000000002";
export const ORTHO_PHYSIO_ID = "a3000000-0003-4000-8000-000000000003";

const orthoFields: SeedField[] = [
  field("patientName", "Patient name", { kind: "text" }, { required: true }),
  field("patientId", "Patient ID", { kind: "text" }, { required: true }),
  field("dateOfBirth", "Date of birth", { kind: "date" }, { required: true }),
  field("affectedJoint", "Affected joint", choice("Knee", "Hip", "Shoulder", "Ankle", "Spine"), { required: true }),
  field("side", "Side", choice("Left", "Right", "Both"), { required: true }),
  field("diagnosis", "Diagnosis", { kind: "text" }, { required: true }),
  field("procedure", "Procedure", choice("Total replacement", "Partial replacement", "Arthroscopy", "Conservative treatment")),
  field("surgeryDate", "Date of surgery", { kind: "date" }),
  field("allergies", "Allergies", { kind: "text" }),
  field("medication", "Current medication", { kind: "text" }),
  field("painLevel", "Pain level", { kind: "scale", min: 0, max: 10, labels: { low: "No pain", high: "Worst pain" } }),
  field("rangeOfMotion", "Range of motion (degrees)", { kind: "number" }),
  field("weightBearing", "Weight bearing", choice("None", "Partial", "As tolerated", "Full")),
];
const byName = (...names: string[]) => orthoFields.filter((f) => names.includes(f.name));

export const ortho: SeedPortfolio = {
  id: ORTHO_ID,
  title: "Orthopedic Patient Record",
  intent: intent(
    "The shared record for patients of the orthopedic department, from diagnosis through surgery to rehabilitation. Each role sees and fills in the part it needs; the patient's data is entered once.",
    "Surgeons, physiotherapists, nursing staff",
    "Patient identifiers follow the hospital's patient ID.",
  ),
  schema: schemaOf(orthoFields),
  status: "published",
};

const surgeonAdded: SeedField[] = [
  field("implantType", "Implant type and size", { kind: "text" }),
  field("asaClass", "ASA class", choice("I", "II", "III", "IV"), { required: true }),
  field("surgicalApproach", "Surgical approach", { kind: "text" }),
];
const surgeonKept = byName("patientName", "patientId", "affectedJoint", "side", "diagnosis", "procedure", "surgeryDate", "allergies", "medication");

export const orthoSurgeon: SeedPortfolio = {
  id: ORTHO_SURGEON_ID,
  title: "Orthopedic Patient Record — Surgical planning",
  intent: intent(
    "What the surgeon needs to plan and document an operation: the diagnosis and procedure from the shared record, plus the implant, the approach and the anaesthetic risk.",
    "Orthopedic surgeons",
  ),
  schema: schemaOf([...surgeonKept, ...surgeonAdded]),
  base_id: ORTHO_ID,
  projection: {
    type: "mixed",
    scenarioIntent: "Surgical planning: diagnosis, procedure, implant and anaesthetic risk",
    includedFieldIds: surgeonKept.map((f) => f.id),
    additionalFields: surgeonAdded,
    fieldMappings: {},
  },
};

const physioAdded: SeedField[] = [
  field("exercisesDone", "Exercises done in this session", { kind: "text" }),
  field("nextSessionGoal", "Goal for the next session", { kind: "text" }),
];
const physioKept = byName("patientName", "patientId", "affectedJoint", "side", "surgeryDate", "painLevel", "rangeOfMotion", "weightBearing");

export const orthoPhysio: SeedPortfolio = {
  id: ORTHO_PHYSIO_ID,
  title: "Orthopedic Patient Record — Rehabilitation session",
  intent: intent(
    "What the physiotherapist records after each rehabilitation session: pain, range of motion and weight bearing from the shared record, plus the exercises done and the goal for next time.",
    "Physiotherapists",
  ),
  schema: schemaOf([...physioKept, ...physioAdded]),
  base_id: ORTHO_ID,
  projection: {
    type: "mixed",
    scenarioIntent: "Rehabilitation sessions: progress after surgery and the plan for the next session",
    includedFieldIds: physioKept.map((f) => f.id),
    additionalFields: physioAdded,
    fieldMappings: {},
  },
};

export const orthoHistory: Record<string, SeedHistory[]> = {
  [ORTHO_ID]: [
    {
      layer: "configuration",
      action: "schema_generated",
      actor: INFORMATICS,
      rationale: "Generated 13 fields from intent",
      minutesAgo: 600,
      added: orthoFields,
    },
  ],
  [ORTHO_SURGEON_ID]: [
    {
      layer: "configuration",
      action: "portfolio_derived",
      actor: SURGEON,
      rationale:
        'Derived from "Orthopedic Patient Record" for: surgical planning — diagnosis, procedure, implant and anaesthetic risk',
      minutesAgo: 240,
    },
  ],
  [ORTHO_PHYSIO_ID]: [
    {
      layer: "configuration",
      action: "portfolio_derived",
      actor: PHYSIO,
      rationale:
        'Derived from "Orthopedic Patient Record" for: rehabilitation sessions — progress after surgery and the plan for the next session',
      minutesAgo: 120,
    },
  ],
};

/** What the physiotherapist types into the derivation page */
export const PHYSIO_SCENARIO =
  "I only need what matters in a rehabilitation session: who the patient is, which joint, pain and range of motion today, and what we do next time.";

// ---------------------------------------------------------------------------
// Starting points for the demo recording: the same scenarios before the
// answers, so the recording can give them on camera
// ---------------------------------------------------------------------------

/** Scenario 1 right after the first draft: five fields, every question open. */
export const soccerStart: SeedPortfolio = {
  id: SOCCER_ID,
  title: "Youth Soccer Registration",
  intent: intent(SOCCER_ONE_LINE),
  schema: schemaOf(soccerFirst),
};
export const soccerStartQuestions: SeedQuestion[] = soccerQuestions.map((q) => ({
  id: q.id,
  text: q.text,
  explanation: q.explanation,
  priority: q.priority,
  options: q.options,
}));
export const soccerStartHistory: SeedHistory[] = soccerHistory.slice(0, 2);

/** Scenario 2 before the co-founder's feedback: no industry question yet. */
export const hiringStart: SeedPortfolio = {
  ...hiring,
  schema: schemaOf(
    hiringFields
      .filter((f) => f !== industry)
      .map((f) => (f.name === "coverLetter" ? { ...f, required: true, description: undefined } : f)),
  ),
};
export const hiringStartHistory: SeedHistory[] = hiringHistory.slice(0, 1);

/**
 * What "Generate questions" returns for the feedback in the recording: the
 * scenario's two questions, in the shape the generation action returns.
 */
export const hiringGenerated = hiringQuestions.slice(0, 2).map((q, i) => ({
  id: `demo-${i}`,
  text: q.text,
  explanation: q.explanation,
  layer: "dimensions",
  source: "llm",
  options: q.options,
  selectedOption: null,
  status: "pending",
  priority: q.priority ?? 2,
  previewStatus: "ready",
}));
