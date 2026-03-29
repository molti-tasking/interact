/**
 * Factual system description of Malleable Forms for Olsen evaluation.
 *
 * This description is the primary evidence the LLM judge uses.
 * Keep it factual — describe what the system DOES, not what it aspires to.
 * Update this when the system changes.
 *
 * Last verified: 2026-03-28
 */

export const SYSTEM_DESCRIPTION = `
## Malleable Forms — System Description

Malleable Forms is an open-source web toolkit for conversational form creation.
It implements "lazy data space elicitation": creators discover their data schema
through a structured conversational process rather than specifying it upfront.

### 1. Intent Editor
The left panel contains a Markdown editor where the creator writes their form
description using structured sections: **Purpose** (what the form collects and why),
**Audience** (who fills it out), **Constraints** (requirements like compliance),
and **Exclusions** (what to leave out). The editor accepts free-form natural
language — no technical notation required. The structured sections are parsed
automatically; misspelled or missing headers are handled gracefully.

### 2. Generation Pipeline
When the creator clicks "Generate Form," the pipeline computes a delta between
the previous and current intent. Based on what changed, it selects a minimal
strategy:
- **Full generation**: if Purpose or Audience changed, regenerate the entire schema
- **Filter-only**: if only Exclusions changed, filter existing fields without regeneration
- **Constraint recheck**: if only Constraints changed, validate existing fields
- **Noop**: if nothing substantive changed, skip regeneration

This means the creator can iteratively refine their intent without starting over.
Each section change triggers only the necessary work.

### 3. Form Schema Generation
An LLM generates a complete form schema from the natural language intent. The system
infers field types, keys, labels, descriptions, tooltips, and validation rules from
the domain description — the creator does not specify these technical details.
Output is validated against a structured JSON schema (Zod). The number of generated
fields depends on the complexity of the intent description.

### 4. Design Probes
After form generation, the system generates 3-5 refinement questions called
"design probes" — e.g., "Who completes this form?", "Should we include previous
surgeries?", "Is the pain assessment for initial or follow-up visits?"

Each probe has 2-4 clickable options. When the creator clicks an option:
- The system updates BOTH the intent AND the schema automatically
- A provenance entry records the decision and rationale
- The resolved probe card disappears from the deck
- New follow-up probes may be generated (0-3 per resolution)

Probes can be **dismissed** (deferred) without resolving them. A "New questions"
button regenerates the probe deck at any time. Probes are phrased in domain
language, not technical terms (e.g., "Should equipment operator certification
be mandatory?" rather than "Add required boolean field operatorCertified").

### 5. Live Form Preview
The right panel shows a real-time preview of the generated form. It updates
after each design probe resolution, intent change, or schema modification.
The creator sees the actual form fields with their labels, descriptions,
tooltips, and input types at every stage of the process.

### 6. Standards Detection
The system automatically detects relevant compliance standards based on intent
keywords (e.g., "OSHA" → construction safety standards, "insurance" → HIPAA-adjacent
fields, "patient" → FHIR R4 healthcare fields). Detected standards are presented
as design probes with "Accept" or "Skip" options. Accepting a standard adds
mandatory, recommended, and optional fields from the standard to the schema.

### 7. Schema Conflict Resolution
After schema updates, the system checks for inconsistencies: duplicate fields, type
mismatches, semantic overlap, naming inconsistencies, and missing required fields.
Detected issues are presented as design probe cards with 2-3 fix options. The system
combines deterministic checks (exact duplicates, orphaned groups) with LLM-based
semantic analysis.

### 8. Provenance Log
Every action is recorded in an append-only provenance log stored in the database:
- Intent updates (which sections changed)
- Design probe resolutions (question, chosen option, rationale)
- Schema updates (fields added, removed, modified)
- Standard acceptances
- Conflict resolutions

Each entry includes the layer (intent/dimensions/configuration), the actor
(creator/system), a diff of what changed, and the previous state. The provenance
log is accessible from the workspace and can be browsed chronologically.

### 9. Three-Column Workspace
The workspace layout shows three panels simultaneously:
- **Left**: Intent editor (always visible)
- **Center**: Design probe cards (pending questions), with a count and loading indicators
- **Right**: Live form preview with rendered fields

All three panels are visible at the same time without tab switching or navigation.

### 10. Persona-Independent Quality
The system is designed for creators at all skill levels. A novice clinic
administrator writing "I need a patient intake form with insurance details"
and an expert data engineer writing detailed constraints with specific field
requirements both interact through the same conversational process. Design
probes present decisions in domain language regardless of skill level. The
system handles technical decisions (field types, validation, schema structure)
automatically.
`.trim();


// ---------------------------------------------------------------------------
// Baseline system descriptions for comparative evaluation
// ---------------------------------------------------------------------------

export const GOOGLE_FORMS_DESCRIPTION = `
## Google Forms — System Description

Google Forms is a free, web-based form builder by Google, widely used for surveys,
registrations, and data collection.

### 1. Form Editor
A single-page WYSIWYG editor where the creator adds questions one at a time.
Each question is configured individually: choose a type (short answer, paragraph,
multiple choice, checkboxes, dropdown, linear scale, date, time, file upload),
type the question text, and optionally add description text.

### 2. Field Types
Supports: short answer, paragraph, multiple choice, checkboxes, dropdown,
file upload, linear scale, multiple choice grid, checkbox grid, date, time.
No support for computed fields, conditional validation, or typed schemas.

### 3. Templates
A gallery of ~20 pre-built templates (Contact Information, RSVP, Event Registration,
Customer Feedback, etc.). Templates provide a starting point but must be manually
customized field by field.

### 4. Logic and Branching
Basic section-based branching: "Go to section X based on answer." No field-level
conditional logic, no computed values, no inter-field dependencies.

### 5. Validation
Per-field validation for text fields only (number, text, length, regex).
No cross-field validation, no domain-specific validation rules.

### 6. Collaboration
Real-time collaborative editing (like Google Docs). Multiple editors can work
simultaneously. Comment threads on questions.

### 7. Response Collection
Responses stored in a linked Google Sheet. Basic summary charts auto-generated.
No schema versioning or provenance tracking.

### 8. No Schema Awareness
Google Forms has no concept of a data schema. Each question is independent.
There is no intent description, no domain standard detection, no automated
field generation, and no mechanism for schema refinement or evolution.
The creator must manually specify every question, type, and option.
`.trim();


export const AIRTABLE_DESCRIPTION = `
## Airtable — System Description

Airtable is a cloud-based platform combining spreadsheet and database features
for structured data collection and management.

### 1. Table Editor
A spreadsheet-like interface where each column is a typed field and each row is
a record. The creator adds fields by clicking "+" and selecting a type. Fields
are configured individually with names, types, and options.

### 2. Field Types
Rich type system: single line text, long text, attachment, checkbox, multiple select,
single select, collaborator, date, phone, email, URL, number, currency, percent,
duration, rating, formula, rollup, count, lookup, created time, last modified time,
auto-number, barcode, button. ~25 field types total.

### 3. Views
Multiple views of the same data: grid (spreadsheet), form (for data collection),
calendar, gallery, kanban, timeline, Gantt. The form view auto-generates a
submission form from the table schema.

### 4. Templates
Extensive template gallery (~100+ templates) organized by category (Project Management,
HR, Sales, Education, etc.). Templates include pre-built tables with fields,
views, and sample data.

### 5. Form Builder
The form view is auto-generated from the table's field definitions. The creator
can reorder fields, add descriptions, mark fields as required, and add cover images.
But the form is always derived from the table schema — there is no independent
form design process.

### 6. Relationships and Lookups
Tables can link to other tables via linked record fields. Lookup, rollup, and
count fields reference linked records. This enables relational data modeling
not available in simple form builders.

### 7. Automations
Trigger-action automations: when a record matches conditions, send email,
update record, run script, call webhook. No AI-assisted schema design.

### 8. Interface Designer
Drag-and-drop page builder for creating custom interfaces on top of table data.
Supports dashboards, detail views, and forms with conditional visibility.

### 9. Schema Management
The creator must understand data types, field configurations, and relational
concepts (linked records, rollups, lookups). There is no natural language input,
no automated field generation, no domain standard detection, and no design probes.
Schema changes are manual: add/rename/delete fields one at a time.
Field descriptions are optional free text — no structured intent or provenance log.
`.trim();
