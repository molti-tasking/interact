/**
 * Invariants for automated schema changes — the ones the workshop pilot
 * showed were missing (8 of 11 participants said the tool changed things
 * they didn't want):
 *
 * 1. **Locked fields** — an automated change (probe answer, intent
 *    refinement, regeneration, conflict fix) never alters, moves or removes
 *    a field the creator locked. `applySchemaPatch` already skips them;
 *    `protectLockedFields` is the backstop applied at commit time to any
 *    automated schema, whatever produced it (see `commitPortfolioChange`).
 * 2. **Patch scoping** — a pre-computed probe answer only touches the fields
 *    its preview showed. The preview records the keys it touched
 *    (`PatchScope`); replaying it later on a newer schema drops every op
 *    outside that set instead of, e.g., turning an "add" into an update of a
 *    field created in the meantime.
 *
 * Plus a field-level description of what a change does to existing fields,
 * so previews can say *what* changes, not just *which* field.
 */

import type {
  Field,
  FieldType,
  PatchScope,
  PortfolioSchema,
  ProbeOptionPreview,
} from "../types";
import {
  applyConflictChanges,
  type ConflictChanges,
} from "./conflict-changes";
import { applySchemaPatch, type SchemaPatch } from "./schema-patch";
import { normalizeSections } from "./sections";

// ---------------------------------------------------------------------------
// 1. Locked fields
// ---------------------------------------------------------------------------

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function groupOf(schema: PortfolioSchema, fieldId: string) {
  return schema.groups.find((g) => g.fieldIds.includes(fieldId)) ?? null;
}

interface ProtectResult {
  schema: PortfolioSchema;
  /** Labels of locked fields the change tried to alter (and was undone) */
  restored: string[];
}

/**
 * Undo whatever `after` did to fields locked in `before`, so the result
 * differs from `after` only in those fields:
 * - a changed locked field gets its locked version back;
 * - a removed one comes back;
 * - each keeps its place: it follows the same field it followed before
 *   (or leads the form), so an automated reorder can't move it either;
 * - it stays in its section, which is re-created if the change removed it;
 * - another field that took a locked field's key is renamed back (an
 *   existing field) or dropped (a field the change added).
 */
export function protectLockedFields(
  before: PortfolioSchema,
  after: PortfolioSchema,
): ProtectResult {
  const locked = before.fields.filter((f) => f.locked);
  if (locked.length === 0) return { schema: after, restored: [] };

  const restored = new Set<string>();
  const lockedIds = new Set(locked.map((f) => f.id));
  const lockedNames = new Set(locked.map((f) => f.name));
  const beforeById = new Map(before.fields.map((f) => [f.id, f]));

  // Unlocked fields as the change left them; key collisions resolved
  const others: Field[] = [];
  for (const f of after.fields) {
    if (lockedIds.has(f.id)) {
      if (!sameJson(beforeById.get(f.id), f)) restored.add(beforeById.get(f.id)!.label);
      continue;
    }
    if (!lockedNames.has(f.name)) {
      others.push(f);
      continue;
    }
    const owner = locked.find((l) => l.name === f.name)!;
    restored.add(owner.label);
    const previous = beforeById.get(f.id);
    // An existing field renamed onto the locked key keeps its old key;
    // a new one reusing it is dropped (it would duplicate the key)
    if (previous && !lockedNames.has(previous.name)) {
      others.push({ ...f, name: previous.name });
    }
  }
  for (const l of locked) {
    if (!after.fields.some((f) => f.id === l.id)) restored.add(l.label);
  }

  // Re-insert every locked field after the field it followed before
  let fields = others;
  before.fields.forEach((original, index) => {
    if (!original.locked) return;
    const anchor = before.fields
      .slice(0, index)
      .reverse()
      .find((b) => fields.some((f) => f.id === b.id));
    const at = anchor ? fields.findIndex((f) => f.id === anchor.id) + 1 : 0;
    fields = [...fields.slice(0, at), original, ...fields.slice(at)];
  });
  // Sections: a locked field stays in (or returns to) its section
  const survivingIds = new Set(fields.map((f) => f.id));
  let groups = after.groups.map((g) => ({
    ...g,
    fieldIds: g.fieldIds.filter(
      (id) =>
        survivingIds.has(id) &&
        (!lockedIds.has(id) || groupOf(before, id)?.id === g.id),
    ),
  }));
  for (const original of locked) {
    const home = groupOf(before, original.id);
    const wasInOther = after.groups.some(
      (g) => g.id !== home?.id && g.fieldIds.includes(original.id),
    );
    if (wasInOther) restored.add(original.label);
    if (!home) continue;
    if (!groups.some((g) => g.id === home.id)) {
      // Re-create it where it was: before the next section that survived
      const next = before.groups
        .slice(before.groups.findIndex((g) => g.id === home.id) + 1)
        .find((b) => groups.some((g) => g.id === b.id));
      const at = next ? groups.findIndex((g) => g.id === next.id) : groups.length;
      groups = [...groups.slice(0, at), { ...home, fieldIds: [] }, ...groups.slice(at)];
    }
    groups = groups.map((g) => {
      if (g.id !== home.id || g.fieldIds.includes(original.id)) return g;
      restored.add(original.label);
      return { ...g, fieldIds: [...g.fieldIds, original.id] };
    });
  }
  groups = groups.filter((g) => g.fieldIds.length > 0);

  // Position changes alone aren't reported: a neighbour added or removed
  // shifts a field too, and "kept locked" would then be noise.
  const schema = normalizeSections({ ...after, fields, groups });
  return { schema, restored: [...restored] };
}

// ---------------------------------------------------------------------------
// 2. Patch scoping
// ---------------------------------------------------------------------------

/** The field keys `patch` adds, changes and removes when applied to `schema`. */
export function patchScope(
  schema: PortfolioSchema,
  patch: SchemaPatch,
  opts: { validTargetIds?: Iterable<string> } = {},
): PatchScope {
  const { applied } = applySchemaPatch(schema, patch, opts);
  return {
    added: applied.added,
    updated: applied.updated,
    removed: applied.removed,
  };
}

/**
 * Keep only the ops of `patch` that stay within `scope` on `schema`:
 * - removals and updates of fields the preview didn't change are dropped;
 * - an add whose key now exists (it would update that field) is dropped
 *   unless the preview changed that field;
 * - an add of a key the preview showed as a change, whose field is gone
 *   meanwhile (the creator deleted it), is dropped — it must not come back;
 * - section placements only for fields in scope.
 */
export function scopePatch(
  schema: PortfolioSchema,
  patch: SchemaPatch,
  scope: PatchScope,
): { patch: SchemaPatch; dropped: string[] } {
  const dropped: string[] = [];
  const keep = (allowed: string[], key: string) => {
    if (allowed.includes(key)) return true;
    if (!dropped.includes(key)) dropped.push(key);
    return false;
  };
  const removed = (patch.removeFieldKeys ?? []).filter((k) =>
    keep(scope.removed, k),
  );
  const remaining = new Set(
    schema.fields.map((f) => f.name).filter((n) => !removed.includes(n)),
  );
  const inScope = new Set([...scope.added, ...scope.updated]);

  const scoped: SchemaPatch = {
    removeFieldKeys: removed,
    updateFields: (patch.updateFields ?? []).filter((f) =>
      keep(scope.updated, f.key),
    ),
    addFields: (patch.addFields ?? []).filter((f) =>
      remaining.has(f.key)
        ? keep(scope.updated, f.key)
        : keep(scope.added, f.key),
    ),
  };
  if (patch.sections) {
    scoped.sections = patch.sections
      .map((s) => ({
        ...s,
        // Placing a field the patch removes is a no-op, not a spill. A
        // placement for an added key must not move a field of that key
        // that exists by now (the add itself is dropped then).
        fieldKeys: s.fieldKeys.filter(
          (k) =>
            !removed.includes(k) &&
            keep(
              remaining.has(k) ? scope.updated : [...inScope],
              k,
            ),
        ),
      }))
      .filter((s) => s.fieldKeys.length > 0);
  }
  return { patch: scoped, dropped };
}

interface AppliedOption {
  schema: PortfolioSchema;
  /** Whether the schema changed at all */
  changed: boolean;
  /** Keys whose ops fell outside the preview's scope */
  dropped: string[];
  /** Keys of locked fields the patch tried to touch */
  locked: string[];
}

/**
 * Apply a pre-computed probe answer to `schema` within its invariants: the
 * patch is limited to the preview's scope and never touches locked fields.
 * Used for the canvas preview, the optimistic update and the commit, so what
 * the creator sees is what gets applied.
 */
export function applyProbeOption(
  schema: PortfolioSchema,
  preview: Pick<ProbeOptionPreview, "schemaPatch" | "scope">,
  opts: { validTargetIds?: Iterable<string> } = {},
): AppliedOption {
  const { patch, dropped } = preview.scope
    ? scopePatch(schema, preview.schemaPatch, preview.scope)
    : { patch: preview.schemaPatch, dropped: [] };
  const { schema: patched, applied, skipped } = applySchemaPatch(
    schema,
    patch,
    opts,
  );
  const changed =
    applied.added.length + applied.updated.length + applied.removed.length > 0;
  // Same backstop as the commit, so the preview can't show more than lands
  const next = changed ? protectLockedFields(schema, patched).schema : patched;
  return { schema: next, changed, dropped, locked: skipped.locked };
}

/**
 * Apply a conflict fix within its invariants: it may only change or remove
 * the fields the conflict is about (plus add new ones), and never a locked
 * field. Ops outside that are dropped and reported.
 */
export function applyConflictFix(
  schema: PortfolioSchema,
  changes: ConflictChanges,
  conflictFieldIds: readonly string[],
): AppliedOption {
  const locked = new Set(schema.fields.filter((f) => f.locked).map((f) => f.id));
  const allowed = new Set(conflictFieldIds);
  const nameOf = (id: string) =>
    schema.fields.find((f) => f.id === id)?.name ?? id;
  const dropped: string[] = [];
  const lockedHit: string[] = [];
  const keep = (id: string) => {
    if (locked.has(id)) {
      lockedHit.push(nameOf(id));
      return false;
    }
    if (!allowed.has(id)) {
      dropped.push(nameOf(id));
      return false;
    }
    return true;
  };
  // Removing a section moves its fields out of it: only for sections that
  // hold nothing but the conflict's own, unlocked fields
  const removeGroupIds = (changes.removeGroupIds ?? []).filter((id) => {
    const group = schema.groups.find((g) => g.id === id);
    if (!group) return true; // unknown: a no-op, reported by applyConflictChanges
    const outside = group.fieldIds.filter((f) => !allowed.has(f) || locked.has(f));
    for (const f of outside) {
      (locked.has(f) ? lockedHit : dropped).push(nameOf(f));
    }
    return outside.length === 0;
  });
  const scoped: ConflictChanges = {
    ...changes,
    removeFieldIds: (changes.removeFieldIds ?? []).filter(keep),
    updateFields: (changes.updateFields ?? []).filter((e) => keep(e.id)),
    removeGroupIds,
  };
  const next = protectLockedFields(
    schema,
    applyConflictChanges(schema, scoped).schema,
  ).schema;
  // Fixes don't reorder: compare content, not order (normalizing sections
  // may reorder a schema that wasn't normalized)
  const content = (s: PortfolioSchema) => ({
    f: [...s.fields].sort((a, b) => a.id.localeCompare(b.id)),
    g: s.groups
      .map((g) => ({ ...g, fieldIds: [...g.fieldIds].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const changed = !sameJson(content(schema), content(next));
  return {
    schema: changed ? next : schema,
    changed,
    dropped,
    locked: lockedHit,
  };
}

/**
 * Limit a whole-schema change (an LLM-resolved conflict fix) to the given
 * fields: any other field it changed or removed gets its `before` version
 * back. Added fields are kept.
 */
export function limitChangeToFields(
  before: PortfolioSchema,
  after: PortfolioSchema,
  fieldIds: readonly string[],
): PortfolioSchema {
  const allowed = new Set(fieldIds);
  const afterIds = new Set(after.fields.map((f) => f.id));
  const beforeById = new Map(before.fields.map((f) => [f.id, f]));
  let fields = after.fields.map((f) =>
    beforeById.has(f.id) && !allowed.has(f.id) ? beforeById.get(f.id)! : f,
  );
  before.fields.forEach((original, index) => {
    if (allowed.has(original.id) || afterIds.has(original.id)) return;
    const anchor = before.fields
      .slice(0, index)
      .reverse()
      .find((b) => fields.some((f) => f.id === b.id));
    const at = anchor ? fields.findIndex((f) => f.id === anchor.id) + 1 : 0;
    fields = [...fields.slice(0, at), original, ...fields.slice(at)];
  });
  // Names must stay unique: a restored field wins over a newcomer
  const names = new Set<string>();
  fields = fields.filter((f) => {
    if (!names.has(f.name)) {
      names.add(f.name);
      return true;
    }
    return beforeById.has(f.id) && !allowed.has(f.id);
  });
  return { ...after, fields };
}

// ---------------------------------------------------------------------------
// 3. What a change does to a field
// ---------------------------------------------------------------------------

const KIND_NAMES: Record<FieldType["kind"], string> = {
  text: "text",
  number: "number",
  select: "choice",
  date: "date",
  boolean: "yes/no",
  file: "file",
  scale: "scale",
  reference: "link",
  group: "group",
};

function kindName(type: FieldType): string {
  if (type.kind === "select" && type.multiple) return "multiple choice";
  return KIND_NAMES[type.kind] ?? type.kind;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Short phrases for how `after` differs from `before`, most consequential
 * first — e.g. ["type text → choice", "now required", "renamed to “Age”"].
 */
export function describeFieldChange(before: Field, after: Field): string[] {
  const out: string[] = [];
  const a = before.type;
  const b = after.type;

  if (a.kind !== b.kind || kindName(a) !== kindName(b)) {
    out.push(`type ${kindName(a)} → ${kindName(b)}`);
  } else if (a.kind === "select" && b.kind === "select") {
    const was = new Set(a.options.map((o) => o.label));
    const now = new Set(b.options.map((o) => o.label));
    const added = [...now].filter((l) => !was.has(l)).length;
    const removed = [...was].filter((l) => !now.has(l)).length;
    if (added) out.push(`+${plural(added, "option")}`);
    if (removed) out.push(`−${plural(removed, "option")}`);
    if (!added && !removed && !sameJson(a.options, b.options)) {
      out.push("options reordered");
    }
  } else if (!sameJson(a, b)) {
    out.push(
      a.kind === "number" || a.kind === "scale"
        ? "range changed"
        : "settings changed",
    );
  }

  if (before.required !== after.required) {
    out.push(after.required ? "now required" : "now optional");
  }
  if (before.label !== after.label) out.push(`renamed to “${after.label}”`);
  if ((before.description ?? "") !== (after.description ?? "")) {
    out.push("help text changed");
  }
  if (!sameJson(before.constraints, after.constraints)) {
    out.push("rules changed");
  }
  return out;
}

/**
 * For every field present in both schemas: what changed about it, including
 * a move to another section. Unchanged fields are absent.
 */
export function describeSchemaChange(
  before: PortfolioSchema,
  after: PortfolioSchema,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const beforeById = new Map(before.fields.map((f) => [f.id, f]));
  for (const field of after.fields) {
    const old = beforeById.get(field.id);
    if (!old) continue;
    const changes = describeFieldChange(old, field);
    const was = groupOf(before, field.id)?.label ?? null;
    const now = groupOf(after, field.id)?.label ?? null;
    if (was !== now) {
      changes.push(now ? `moved to “${now}”` : "moved out of its section");
    }
    if (changes.length) out[field.id] = changes;
  }
  return out;
}
