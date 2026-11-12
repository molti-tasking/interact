/**
 * Malleable Forms engine: the deterministic kernel around the LLM calls.
 *
 * Pure and isomorphic — no database, no framework, no model client. The
 * model proposes (a patch, a purpose edit, a set of drafts); these modules
 * decide what lands: patching, locked fields, patch scoping, merges,
 * disagreement-based probe selection, findings from responses.
 *
 * Consumed as TypeScript source (`interact/forms` or `interact/forms/<module>`);
 * a Next.js app needs `transpilePackages: ["interact"]`.
 */
export * from "./conflict-changes";
export * from "./dashboard";
export * from "./decision-guard";
export * from "./findings";
export * from "./form-diversity";
export * from "./form-model";
export * from "./guards";
export * from "./intent-refinement";
export * from "./intent-sync";
export * from "./merge";
export * from "./pretest";
export * from "./probe-curation";
export * from "./probe-disagreement";
export * from "./probe-options";
export * from "./probe-preview";
export * from "./prompt";
export * from "./purpose-edit";
export * from "./recode";
export * from "./replay-metrics";
export * from "./response-rows";
export * from "./response-stats";
export * from "./response-versions";
export * from "./scale";
export * from "./schema-ops";
export * from "./schema-patch";
export * from "./sections";
export * from "./structured-intent";
export * from "./types";
export * from "./values";
