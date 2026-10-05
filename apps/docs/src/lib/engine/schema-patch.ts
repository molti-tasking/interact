/**
 * Pure, isomorphic schema patching.
 *
 * LLM-driven changes (design probe resolution, voice schema edits) are
 * expressed as a *patch* against the schema rather than a whole new schema.
 * Keeping the patch separate lets the client re-apply it to the freshest
 * database state at commit time (see `commitPortfolioChange`), so a change
 * computed from a snapshot taken before a multi-second LLM call never
 * overwrites edits that landed in the meantime.
 */

import type { Field, FieldGroup, FieldType, PortfolioSchema } from "../types";

// ---------------------------------------------------------------------------
// Patch shape (mirrors the LLM structured-output schema)
// ---------------------------------------------------------------------------

export type PatchFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "email"
  | "select"
  | "reference";

export interface PatchField {
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  type: PatchFieldKind;
  required: boolean;
  validation?: { options?: unknown[] };
  referenceTarget?: string;
}

export interface SchemaPatch {
  addFields?: PatchField[];
  removeFieldKeys?: string[];
  updateFields?: PatchField[];
}

export interface ApplyPatchResult {
  schema: PortfolioSchema;
  /** Field names that were actually changed */
  applied: { added: string[]; updated: string[]; removed: string[] };
  /** Ops that referenced fields that don't exist (no-ops) */
  skipped: { updated: string[]; removed: string[] };
}

// ---------------------------------------------------------------------------
// Field type conversion
// ---------------------------------------------------------------------------

/** The coarse LLM-facing kind for an existing field type. */
function coarseKind(type: FieldType): PatchFieldKind {
  switch (type.kind) {
    case "text":
    case "file":
    case "group":
      return "string";
    case "scale":
      return "number";
    default:
      return type.kind;
  }
}

function isCompatible(patchKind: PatchFieldKind, existing: FieldType): boolean {
  const normalized = patchKind === "email" ? "string" : patchKind;
  return coarseKind(existing) === normalized;
}

/** Coerce options to {label, value}[] — handles both string and object inputs. */
export function normalizeOptions(
  raw: unknown,
): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    if (typeof o === "string") return { label: o, value: o };
    if (o && typeof o === "object" && "value" in o && "label" in o)
      return { label: String(o.label), value: String(o.value) };
    if (o && typeof o === "object" && "value" in o)
      return { label: String(o.value), value: String(o.value) };
    if (o && typeof o === "object" && "label" in o)
      return { label: String(o.label), value: String(o.label) };
    const s = String(o);
    return { label: s, value: s };
  });
}

/** Build a fresh FieldType from the coarse LLM kind. */
export function convertPatchFieldType(
  type: PatchFieldKind | string,
  validation?: { options?: unknown[] },
): FieldType {
  switch (type) {
    case "select":
      return {
        kind: "select",
        options: normalizeOptions(validation?.options),
        multiple: false,
      };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "date":
      return { kind: "date" };
    default:
      return { kind: "text" };
  }
}

/**
 * Resolve the FieldType for a patched field. When the LLM keeps the field's
 * kind, the existing type is preserved (number min/max/unit, select
 * `multiple`, scale range + labels, file accept, group children, …) because
 * the coarse patch vocabulary cannot express those details.
 */
export function resolvePatchFieldType(
  f: Pick<PatchField, "type" | "validation" | "referenceTarget">,
  validTargetIds: ReadonlySet<string>,
  existing?: FieldType,
): FieldType {
  if (f.type === "reference") {
    if (f.referenceTarget && validTargetIds.has(f.referenceTarget)) {
      return existing?.kind === "reference"
        ? { ...existing, targetPortfolioId: f.referenceTarget }
        : { kind: "reference", targetPortfolioId: f.referenceTarget };
    }
    // Keep an existing link when the LLM omits or invents the target;
    // otherwise degrade to text rather than dangling.
    if (existing?.kind === "reference") return existing;
    return { kind: "text" };
  }

  if (existing && isCompatible(f.type, existing)) {
    if (existing.kind === "select") {
      const proposed = normalizeOptions(f.validation?.options);
      // LLM omitted options (e.g. label-only update) → keep the existing ones
      if (proposed.length === 0) return existing;
      // Keep stored values for options whose label survived, so existing
      // responses still match after a rewrite.
      const valueByLabel = new Map(
        existing.options.map((o) => [o.label.trim().toLowerCase(), o.value]),
      );
      return {
        ...existing,
        options: proposed.map((o) => ({
          label: o.label,
          value: valueByLabel.get(o.label.trim().toLowerCase()) ?? o.value,
        })),
      };
    }
    return existing;
  }

  return convertPatchFieldType(f.type, f.validation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function newFieldId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `field-${uuid}`
    : `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Drop removed field ids from groups and clear conditionals that point at them. */
export function pruneGroups(
  groups: FieldGroup[],
  survivingIds: ReadonlySet<string>,
): FieldGroup[] {
  return groups
    .map((g) => ({
      ...g,
      fieldIds: g.fieldIds.filter((id) => survivingIds.has(id)),
      conditional:
        g.conditional && survivingIds.has(g.conditional.fieldId)
          ? g.conditional
          : undefined,
    }))
    .filter((g) => g.fieldIds.length > 0);
}

function mergeUpdate(
  existing: Field,
  update: PatchField,
  validTargetIds: ReadonlySet<string>,
): Field {
  return {
    ...existing,
    label: update.label || existing.label,
    type: resolvePatchFieldType(update, validTargetIds, existing.type),
    required: update.required ?? existing.required,
    // The prompt tells the model to omit these when unchanged — omission
    // must not erase what's there.
    description: update.description ?? existing.description,
    tooltip: update.tooltip ?? existing.tooltip,
  };
}

// ---------------------------------------------------------------------------
// applySchemaPatch
// ---------------------------------------------------------------------------

/**
 * Apply an LLM schema patch. Order: remove → update → add.
 * - `addFields` whose key already exists are treated as updates (upsert),
 *   so the schema never ends up with duplicate field names.
 * - Updates/removals for unknown keys are reported in `skipped`.
 */
export function applySchemaPatch(
  schema: PortfolioSchema,
  patch: SchemaPatch,
  opts: { validTargetIds?: Iterable<string> } = {},
): ApplyPatchResult {
  const validTargetIds = new Set(opts.validTargetIds ?? []);
  const applied: ApplyPatchResult["applied"] = {
    added: [],
    updated: [],
    removed: [],
  };
  const skipped: ApplyPatchResult["skipped"] = { updated: [], removed: [] };

  let fields = [...schema.fields];

  // Remove
  if (patch.removeFieldKeys?.length) {
    const existingNames = new Set(fields.map((f) => f.name));
    const removeSet = new Set<string>();
    for (const key of patch.removeFieldKeys) {
      if (existingNames.has(key)) removeSet.add(key);
      else skipped.removed.push(key);
    }
    fields = fields.filter((f) => !removeSet.has(f.name));
    applied.removed.push(...removeSet);
  }

  // Update (+ adds that collide with an existing key)
  const updates = new Map<string, PatchField>();
  for (const u of patch.updateFields ?? []) updates.set(u.key, u);
  const namesAfterRemove = new Set(fields.map((f) => f.name));
  const genuineAdds: PatchField[] = [];
  const seenAddKeys = new Set<string>();
  for (const a of patch.addFields ?? []) {
    if (seenAddKeys.has(a.key)) continue; // duplicate add in the same patch
    seenAddKeys.add(a.key);
    if (namesAfterRemove.has(a.key)) {
      if (!updates.has(a.key)) updates.set(a.key, a);
    } else {
      genuineAdds.push(a);
    }
  }

  if (updates.size) {
    fields = fields.map((existing) => {
      const update = updates.get(existing.name);
      if (!update) return existing;
      applied.updated.push(existing.name);
      return mergeUpdate(existing, update, validTargetIds);
    });
    for (const key of updates.keys()) {
      if (!namesAfterRemove.has(key)) skipped.updated.push(key);
    }
  }

  // Add
  for (const f of genuineAdds) {
    fields.push({
      id: newFieldId(),
      name: f.key,
      label: f.label,
      type: resolvePatchFieldType(f, validTargetIds),
      required: f.required,
      constraints: [],
      description: f.description,
      tooltip: f.tooltip,
      origin: "system",
      tags: [],
    });
    applied.added.push(f.key);
  }

  const survivingIds = new Set(fields.map((f) => f.id));
  const changed =
    applied.added.length + applied.updated.length + applied.removed.length > 0;

  return {
    schema: {
      ...schema,
      fields,
      groups: pruneGroups(schema.groups ?? [], survivingIds),
      version: changed ? schema.version + 1 : schema.version,
    },
    applied,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// mergeRegeneratedSchema
// ---------------------------------------------------------------------------

/**
 * Fold a freshly generated schema (full pipeline run) into the current one
 * instead of replacing it wholesale:
 * - generated fields that match an existing field by name keep that field's
 *   id (stable provenance) and, when the kind is unchanged, its type details;
 * - creator-authored fields the generator didn't reproduce are kept;
 * - schema metadata (accepted standards, saved column actions, groups) is
 *   carried over;
 * - the version keeps increasing monotonically.
 */
export function mergeRegeneratedSchema(
  current: PortfolioSchema,
  generated: PortfolioSchema,
): PortfolioSchema {
  const currentByName = new Map(current.fields.map((f) => [f.name, f]));
  const generatedNames = new Set(generated.fields.map((f) => f.name));

  const merged: Field[] = generated.fields.map((g) => {
    const existing = currentByName.get(g.name);
    if (!existing) return g;
    const sameKind = existing.type.kind === g.type.kind;
    return {
      ...g,
      id: existing.id,
      origin: existing.origin,
      constraints: g.constraints.length ? g.constraints : existing.constraints,
      tags: existing.tags,
      derivedFrom: existing.derivedFrom,
      type: sameKind
        ? g.type.kind === "select" && existing.type.kind === "select"
          ? resolvePatchFieldType(
              { type: "select", validation: { options: g.type.options } },
              new Set(),
              existing.type,
            )
          : existing.type
        : g.type,
    };
  });

  for (const f of current.fields) {
    if (f.origin === "creator" && !generatedNames.has(f.name)) {
      merged.push(f);
    }
  }

  const survivingIds = new Set(merged.map((f) => f.id));

  return {
    ...current,
    ...generated,
    fields: merged,
    groups: pruneGroups(
      [...(current.groups ?? []), ...(generated.groups ?? [])],
      survivingIds,
    ),
    acceptedStandards:
      generated.acceptedStandards ?? current.acceptedStandards,
    columnActions: current.columnActions ?? generated.columnActions,
    version: Math.max(current.version, generated.version) + 1,
  };
}
