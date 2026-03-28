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

### 1. Structured Intent Editor
The left panel contains a Markdown editor where the creator writes their form
description using structured sections: **Purpose** (what the form collects and why),
**Audience** (who fills it out), **Constraints** (requirements like compliance),
and **Exclusions** (what to leave out). The editor accepts free-form natural
language — no technical notation required. The structured sections are parsed
automatically; misspelled or missing headers are handled gracefully.

### 2. Smart Pipeline
When the creator clicks "Generate Form," the system computes a delta between
the previous and current intent. Based on what changed, it selects a minimal
pipeline strategy:
- **Full generation**: if Purpose or Audience changed, regenerate the entire schema
- **Filter-only**: if only Exclusions changed, filter existing fields without regeneration
- **Constraint recheck**: if only Constraints changed, validate existing fields
- **Noop**: if nothing substantive changed, skip regeneration

This means the creator can iteratively refine their intent without starting over.
Each section change triggers only the necessary work.

### 3. Form Schema Generation
An LLM generates a complete form schema from the natural language intent. A single
paragraph like "Create a rental agreement form for construction equipment with OSHA
compliance" typically produces 20-30 fields with appropriate types (text, number,
date, select, boolean, email), labels, descriptions, tooltips, and validation rules.
The creator does NOT specify field types, keys, or constraints — the system infers
these from the domain description. Output uses structured JSON schema (Zod-validated).

### 4. Design Probes (Directed Backtalk)
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

### 6. Domain Standards Detection
The system automatically detects relevant compliance standards based on intent
keywords (e.g., "OSHA" → construction safety standards, "insurance" → HIPAA-adjacent
fields, "patient" → FHIR R4 healthcare fields). Detected standards are presented
as design probes with "Accept" or "Skip" options. Accepting a standard adds
mandatory, recommended, and optional fields from the standard to the schema.

### 7. Conflict Detection
After schema updates, the system detects conflicts: duplicate fields, type
mismatches, semantic overlap, naming inconsistencies, and missing required fields.
Conflicts are presented as design probe cards with 2-3 fix options. The system
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
- **Left**: Structured intent editor (always visible)
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
