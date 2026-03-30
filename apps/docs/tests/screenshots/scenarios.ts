/**
 * Scenario seed data for paper screenshots.
 *
 * Each scenario matches a section in the UIST'26 paper (Section 5).
 * Data is seeded directly into the database to produce deterministic,
 * realistic screenshots without requiring LLM calls.
 */

import { field, structuredIntent } from "./helpers";

// ---------------------------------------------------------------------------
// Scenario 1: Construction Machine Rental (Section 5.1)
// Principle in focus: all four design principles
// ---------------------------------------------------------------------------

export const RENTAL_PORTFOLIO_ID = "a0000001-0001-4000-8000-000000000001";

export const rentalPortfolio = {
  id: RENTAL_PORTFOLIO_ID,
  title: "Rental Machine Contract",
  intent: structuredIntent(
    "I need a rental contract form for our construction machines with degressive weekly/monthly pricing and delivery logistics.",
    "Business owner, office manager, dispatchers",
  ),
  schema: {
    fields: [
      field("f1", "machineCategory", "Machine Category", {
        kind: "select",
        options: [
          { label: "Excavator", value: "excavator" },
          { label: "Crane", value: "crane" },
          { label: "Bulldozer", value: "bulldozer" },
          { label: "Forklift", value: "forklift" },
          { label: "Compactor", value: "compactor" },
        ],
        multiple: false,
      }, { required: true, description: "Type of construction machine" }),
      field("f2", "machineModel", "Machine Model", { kind: "text" }, { description: "Specific model identifier (e.g. Excavator #EX-101)" }),
      field("f3", "weightClass", "Weight Class", {
        kind: "select",
        options: [
          { label: "< 5 tons", value: "light" },
          { label: "5\u201315 tons", value: "medium" },
          { label: "> 15 tons", value: "heavy" },
        ],
        multiple: false,
      }, { required: true }),
      field("f4", "rentalStart", "Rental Period Start", { kind: "date" }, { required: true }),
      field("f5", "rentalEnd", "Rental Period End", { kind: "date" }, { required: true }),
      field("f6", "pricingModel", "Pricing Model", {
        kind: "select",
        options: [
          { label: "Daily flat rate", value: "daily" },
          { label: "Degressive weekly", value: "weekly" },
          { label: "Degressive monthly", value: "monthly" },
        ],
        multiple: false,
      }, { required: true }),
      field("f7", "customerName", "Customer Name", { kind: "text" }, { required: true, description: "Full name of the renting party" }),
      field("f8", "customerCompany", "Company", { kind: "text" }),
      field("f9", "customerPhone", "Phone Number", { kind: "text" }, { required: true }),
      field("f10", "customerEmail", "Email Address", { kind: "text" }, { required: true, description: "Contact email for contract correspondence" }),
      field("f11", "deliveryAddress", "Delivery Address", { kind: "text" }, { required: true, description: "Full address of the construction site" }),
      field("f12", "siteAccessRestrictions", "Site Access Restrictions", { kind: "text" }, { description: "Weight limits, height clearance, access hours" }),
      field("f13", "deliveryTimeWindow", "Preferred Delivery Time", {
        kind: "select",
        options: [
          { label: "Morning (6:00\u201310:00)", value: "morning" },
          { label: "Midday (10:00\u201314:00)", value: "midday" },
          { label: "Afternoon (14:00\u201318:00)", value: "afternoon" },
        ],
        multiple: false,
      }),
      field("f14", "operatorCertification", "Operator Certification Required", { kind: "boolean" }, { description: "Does the operator need certification before handover?" }),
      field("f15", "specialInstructions", "Special Instructions", { kind: "text" }, { description: "Additional notes for the rental" }),
    ],
    groups: [],
    version: 1,
  },
};

export const rentalDesignProbes = [
  {
    id: "c0000001-0001-4000-8000-000000000001",
    text: "Should the form capture operator certification details?",
    explanation: "Operating construction machines requires certification in most jurisdictions. Adding certification fields ensures compliance before handover.",
    layer: "dimensions",
    options: [
      { value: "addCertification", label: "Yes, require certification details" },
      { value: "skipCertification", label: "No, handle separately" },
    ],
    dimensionName: "Operator Safety",
  },
  {
    id: "c0000001-0002-4000-8000-000000000002",
    text: "Should a pre-delivery condition checklist be included?",
    explanation: "Insurance providers often require photographic documentation of machine condition before and after rental to process claims.",
    layer: "dimensions",
    options: [
      { value: "addChecklist", label: "Yes, add condition checklist" },
      { value: "basicOnly", label: "No, basic contract is sufficient" },
    ],
    dimensionName: "Insurance Compliance",
  },
  {
    id: "c0000001-0003-4000-8000-000000000003",
    text: "How should recurring bookings be handled?",
    explanation: "Long-term construction projects often need recurring weekly or monthly rentals with automatic renewal.",
    layer: "intent",
    options: [
      { value: "recurring", label: "Allow recurring bookings" },
      { value: "oneTime", label: "One-time only" },
      { value: "decideLater", label: "Decide later" },
    ],
    dimensionName: "Booking Logic",
  },
];

export const rentalProvenance = [
  { layer: "intent", action: "intent_updated", actor: "creator", rationale: "Sections changed: purpose" },
  { layer: "configuration", action: "schema_generated", actor: "system", rationale: "Generated 15 fields from intent", diff: { added: rentalPortfolio.schema.fields.map(f => ({ name: f.name })), removed: [], modified: [] } },
  { layer: "dimensions", action: "design_probe_resolved", actor: "creator", rationale: '"Should the form capture operator certification details?" \u2192 "Yes, require certification details"', diff: { added: [{ name: "certType" }, { name: "certExpiry" }, { name: "issuingBody" }], removed: [], modified: [] } },
  { layer: "dimensions", action: "design_probe_resolved", actor: "creator", rationale: '"Should a pre-delivery condition checklist be included?" \u2192 "Yes, add condition checklist"', diff: { added: [{ name: "conditionPhotos" }, { name: "damageNotes" }, { name: "inspectorSignature" }], removed: [], modified: [] } },
  { layer: "intent", action: "intent_updated", actor: "creator", rationale: "Insurance provider requires photographic condition documentation for all contracts effective 2026-03-15." },
];

// ---------------------------------------------------------------------------
// Scenario 3: Orthopedic Patient Records (Section 5.3)
// Principle in focus: Scenario-Driven Derivation
// ---------------------------------------------------------------------------

export const ORTHO_BASE_ID = "b0000001-0001-4000-8000-000000000001";
export const ORTHO_SURGEON_ID = "b0000001-0002-4000-8000-000000000002";
export const ORTHO_PATIENT_ID = "b0000001-0003-4000-8000-000000000003";

export const orthoBaseFields = [
  field("o1", "patientName", "Patient Name", { kind: "text" }, { required: true, description: "Full legal name" }),
  field("o2", "dateOfBirth", "Date of Birth", { kind: "date" }, { required: true }),
  field("o3", "patientId", "Patient ID", { kind: "text" }, { required: true, description: "Hospital medical record number" }),
  field("o4", "admissionDate", "Admission Date", { kind: "date" }, { required: true }),
  field("o5", "primaryDiagnosis", "Primary Diagnosis", { kind: "text" }, { required: true, description: "ICD-10 code and description" }),
  field("o6", "referringPhysician", "Referring Physician", { kind: "text" }),
  field("o7", "bloodPressure", "Blood Pressure", { kind: "text" }, { description: "Systolic/Diastolic mmHg" }),
  field("o8", "heartRate", "Heart Rate", { kind: "number", unit: "bpm" }, { description: "Resting heart rate" }),
  field("o9", "medicationList", "Current Medications", { kind: "text" }, { required: true, description: "Include dosage and frequency" }),
  field("o10", "allergies", "Known Allergies", { kind: "text" }, { required: true }),
  field("o11", "clinicalNotes", "Clinical Notes", { kind: "text" }, { description: "Physician's assessment and treatment plan" }),
  field("o12", "surgicalHistory", "Surgical History", { kind: "text" }, { description: "Previous orthopedic procedures" }),
  field("o13", "imagingResults", "Imaging Results", { kind: "text" }, { description: "X-ray, MRI, CT scan findings" }),
  field("o14", "implantSpecs", "Implant Specifications", { kind: "text" }, { description: "Manufacturer, model, lot number" }),
  field("o15", "weightBearingStatus", "Weight-Bearing Status", {
    kind: "select",
    options: [
      { label: "NWB \u2014 Non-Weight-Bearing", value: "nwb" },
      { label: "TTWB \u2014 Toe-Touch Weight-Bearing", value: "ttwb" },
      { label: "PWB \u2014 Partial Weight-Bearing", value: "pwb" },
      { label: "WBAT \u2014 Weight-Bearing As Tolerated", value: "wbat" },
      { label: "FWB \u2014 Full Weight-Bearing", value: "fwb" },
    ],
    multiple: false,
  }, { required: true, description: "Post-operative weight-bearing protocol" }),
];

export const orthoBasePortfolio = {
  id: ORTHO_BASE_ID,
  title: "Orthopedic Patient Record",
  intent: structuredIntent(
    "I need a patient record system for our orthopedic department covering demographics, diagnosis, vitals, medications, surgical details, and imaging.",
    "Clinical informatics lead, surgeons, physiotherapists, patients",
  ),
  schema: { fields: orthoBaseFields, groups: [], version: 1 },
};

export const orthoSurgeonFields = [
  ...orthoBaseFields,
  field("s1", "preOpProtocol", "Pre-Operative Protocol", { kind: "text" }, { required: true, description: "Pre-surgical preparation steps" }),
  field("s2", "postOpProtocol", "Post-Operative Protocol", { kind: "text" }, { required: true, description: "Recovery and follow-up instructions" }),
  field("s3", "anesthesiaType", "Anesthesia Type", {
    kind: "select",
    options: [
      { label: "General", value: "general" },
      { label: "Regional (spinal/epidural)", value: "regional" },
      { label: "Local", value: "local" },
    ],
    multiple: false,
  }, { required: true }),
  field("s4", "estimatedDuration", "Estimated Surgical Duration", { kind: "number", unit: "minutes" }),
];

export const orthoSurgeonPortfolio = {
  id: ORTHO_SURGEON_ID,
  title: "Orthopedic Patient Record \u2014 Surgeon View",
  intent: structuredIntent(
    "Surgeon's view: all patient data plus surgical history, imaging, implant specs, pre/post-operative protocols, and weight-bearing status.",
  ),
  schema: { fields: orthoSurgeonFields, groups: [], version: 1 },
  base_id: ORTHO_BASE_ID,
  projection: {
    type: "super",
    scenarioIntent: "Surgeon's complete view with surgical planning and operative details",
    includedFieldIds: orthoBaseFields.map((f) => f.id),
    additionalFields: orthoSurgeonFields.slice(orthoBaseFields.length),
    fieldMappings: {},
  },
};

const patientFieldIds = ["o1", "o2", "o5", "o9", "o10", "o15"];

export const orthoPatientFields = [
  field("o1", "patientName", "Your Name", { kind: "text" }, { required: true }),
  field("o2", "dateOfBirth", "Date of Birth", { kind: "date" }, { required: true }),
  field("o5", "primaryDiagnosis", "Your Diagnosis", { kind: "text" }, { required: true, description: "In plain language" }),
  field("o9", "medicationList", "Your Medications", { kind: "text" }, { required: true, description: "List all current medications" }),
  field("o10", "allergies", "Allergies", { kind: "text" }, { required: true }),
  field("o15", "weightBearingStatus", "Weight-Bearing Restrictions", {
    kind: "select",
    options: [
      { label: "No weight on leg", value: "nwb" },
      { label: "Toe-touch only", value: "ttwb" },
      { label: "Partial weight OK", value: "pwb" },
      { label: "As tolerated", value: "wbat" },
      { label: "Full weight OK", value: "fwb" },
    ],
    multiple: false,
  }, { required: true, description: "Your current movement restrictions" }),
  field("p1", "exerciseProgram", "Exercise Program", { kind: "text" }, { description: "Your assigned exercises and instructions" }),
  field("p2", "nextAppointment", "Next Appointment", { kind: "date" }),
];

export const orthoPatientPortfolio = {
  id: ORTHO_PATIENT_ID,
  title: "Orthopedic Patient Record \u2014 Patient Portal",
  intent: structuredIntent(
    "Patient-facing view: diagnosis in plain language, medications, allergies, weight-bearing restrictions, exercise program, and next appointment.",
  ),
  schema: { fields: orthoPatientFields, groups: [], version: 1 },
  base_id: ORTHO_BASE_ID,
  projection: {
    type: "sub",
    scenarioIntent: "Patient portal showing only patient-relevant information in plain language",
    includedFieldIds: patientFieldIds,
    additionalFields: orthoPatientFields.filter((f) => !patientFieldIds.includes(f.id)),
    fieldMappings: {},
  },
};
