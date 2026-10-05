/**
 * Human-readable formatting for the provenance log (Design Principle 3:
 * decision traceability). Pure helpers shared by the History timeline and the
 * dashboard.
 */

import type {
  Field,
  FieldType,
  ProvenanceLayer,
  SchemaDiff,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const ACTION_LABELS = new Map<string, string>([
  ["schema_generated", "Generated the form from the intent"],
  ["intent_updated", "Updated the intent"],
  ["intent_synced_from_edit", "Synced the intent with a form edit"],
  ["design_probe_resolved", "Answered a design probe"],
  ["design_probe_re_resolved", "Changed a design probe answer"],
  ["field_modified", "Edited a field"],
  ["field_removed", "Removed a field"],
  ["field_added_from_prompt", "Added fields from a prompt"],
  ["prompt_edit", "Edited the form from a prompt"],
  ["standard_accepted", "Adopted a domain standard"],
  ["exclusions_applied", "Applied exclusions from the intent"],
  ["conflict_resolved", "Resolved a conflict"],
  ["column_action_saved", "Saved a column action"],
  ["column_action_remembered", "Saved a column action"],
  ["change_reverted", "Undid a change"],
  ["snapshot_restored", "Restored an earlier version"],
  ["voice_edit", "Edited the form by voice"],
]);

/** "design_probe_resolved" → "design probe resolved" → "Design probe resolved". */
export function sentenceCase(raw: string): string {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/** Readable label for a provenance `action` (falls back to sentence case). */
export function formatProvenanceAction(action: string): string {
  const known = ACTION_LABELS.get(action);
  if (known) return known;
  if (action.startsWith("voice_")) {
    const rest = sentenceCase(action.slice("voice_".length));
    return rest ? `${rest} (by voice)` : "Voice edit";
  }
  return sentenceCase(action) || "Change";
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export const LAYER_META: Record<
  ProvenanceLayer,
  { label: string; description: string }
> = {
  intent: { label: "Intent", description: "What the form is for" },
  dimensions: { label: "Dimensions", description: "Design decisions" },
  configuration: { label: "Configuration", description: "Fields & schema" },
};

export function formatLayer(layer: string): string {
  return (LAYER_META as Record<string, { label: string }>)[layer]?.label ??
    sentenceCase(layer);
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

export interface ParsedActor {
  /** Stable grouping key (normalised actor string). */
  key: string;
  name: string;
  role: string | null;
  isSystem: boolean;
}

const SYSTEM_ACTORS = new Set(["system", "ai", "assistant", "llm"]);

/**
 * Actors are stored as free text: "system", "creator" (legacy) or
 * `formatActor(user)` → "Alex (Coach)".
 */
export function parseActor(actor: string | null | undefined): ParsedActor {
  const raw = (actor ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return { key: "unknown", name: "Unknown", role: null, isSystem: false };
  if (SYSTEM_ACTORS.has(raw.toLowerCase())) {
    return { key: "system", name: "System", role: null, isSystem: true };
  }
  const match = raw.match(/^(.*?)\s*\(([^()]*)\)$/);
  if (match && match[1]) {
    const name = match[1].trim();
    const role = match[2].trim() || null;
    return {
      key: role ? `${name} (${role})` : name,
      name,
      role,
      isSystem: false,
    };
  }
  const name = raw.toLowerCase() === "creator" ? "Creator" : raw;
  return { key: name, name, role: null, isSystem: false };
}

export function formatActorLabel(actor: ParsedActor): string {
  return actor.role ? `${actor.name} (${actor.role})` : actor.name;
}

// ---------------------------------------------------------------------------
// Fields & diffs
// ---------------------------------------------------------------------------

/** Best display name for a (possibly partial) field: label → name → id. */
export function fieldDisplayName(field: Partial<Field> | null | undefined): string {
  if (!field) return "Unnamed field";
  if (field.label?.trim()) return field.label.trim();
  if (field.name?.trim()) return sentenceCase(field.name);
  return field.id ?? "Unnamed field";
}

export function formatFieldType(type: FieldType | null | undefined): string {
  if (!type || typeof type !== "object" || !("kind" in type)) return "";
  switch (type.kind) {
    case "text":
      return "Text";
    case "number":
      return type.unit ? `Number (${type.unit})` : "Number";
    case "select": {
      const n = type.options?.length ?? 0;
      const kind = type.multiple ? "Multi-select" : "Select";
      return `${kind} · ${n} option${n === 1 ? "" : "s"}`;
    }
    case "date":
      return "Date";
    case "boolean":
      return "Yes / no";
    case "file":
      return "File";
    case "scale":
      return `Scale ${type.min}–${type.max}`;
    case "reference":
      return "Reference";
    case "group": {
      const n = type.fields?.length ?? 0;
      return `Group · ${n} field${n === 1 ? "" : "s"}`;
    }
    default:
      return sentenceCase(String((type as { kind?: unknown }).kind ?? ""));
  }
}

export interface FieldPropertyChange {
  property: string;
  before: string;
  after: string;
}

const MAX_OPTIONS_SHOWN = 6;

function formatOptions(type: FieldType | undefined): string {
  if (!type || type.kind !== "select") return "";
  const labels = (type.options ?? []).map((o) => o.label || o.value);
  if (labels.length === 0) return "none";
  const shown = labels.slice(0, MAX_OPTIONS_SHOWN).join(", ");
  const more = labels.length - MAX_OPTIONS_SHOWN;
  return more > 0 ? `${shown} +${more} more` : shown;
}

function yesNo(value: boolean | undefined): string {
  return value === undefined ? "" : value ? "Yes" : "No";
}

/**
 * Property-level changes between two versions of a field, limited to what a
 * form designer cares about (label, type, required, options, description, …).
 */
export function describeFieldChanges(
  before: Partial<Field> | null | undefined,
  after: Partial<Field> | null | undefined,
): FieldPropertyChange[] {
  const a = before ?? {};
  const b = after ?? {};
  const changes: FieldPropertyChange[] = [];
  const push = (property: string, x: string, y: string) => {
    if (x !== y) changes.push({ property, before: x || "—", after: y || "—" });
  };

  push("Label", a.label ?? "", b.label ?? "");
  push("Type", formatFieldType(a.type), formatFieldType(b.type));
  push("Required", yesNo(a.required), yesNo(b.required));
  if (a.type?.kind === "select" || b.type?.kind === "select") {
    push("Options", formatOptions(a.type), formatOptions(b.type));
  }
  push("Description", a.description ?? "", b.description ?? "");
  push("Help text", a.tooltip ?? "", b.tooltip ?? "");
  push(
    "Validation rules",
    a.constraints ? String(a.constraints.length) : "",
    b.constraints ? String(b.constraints.length) : "",
  );
  if (!a.label && !b.label) push("Key", a.name ?? "", b.name ?? "");

  if (changes.length === 0 && JSON.stringify(a) !== JSON.stringify(b)) {
    changes.push({
      property: "Other settings",
      before: "changed",
      after: "changed",
    });
  }
  return changes;
}

export function summarizeDiff(diff: SchemaDiff | null | undefined) {
  const added = diff?.added?.length ?? 0;
  const removed = diff?.removed?.length ?? 0;
  const modified = diff?.modified?.length ?? 0;
  return { added, removed, modified, total: added + removed + modified };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", else a date. */
export function formatRelativeTime(
  iso: string,
  now: number,
  locale?: string,
): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 45_000 && diff > -45_000) return "just now";
  if (diff < 0) return formatAbsoluteTime(iso, locale);
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MINUTE)), "minute");
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), "hour");
  if (diff < 7 * DAY) return rtf.format(-Math.round(diff / DAY), "day");
  return new Date(t).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatAbsoluteTime(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface DayGroup<T> {
  /** Local calendar day, YYYY-MM-DD. */
  key: string;
  label: string;
  entries: T[];
}

/**
 * Group entries (already sorted) by local calendar day, keeping order.
 * Labels: "Today", "Yesterday", else a long date.
 */
export function groupByDay<T extends { created_at: string }>(
  entries: readonly T[],
  now: number,
  locale?: string,
): DayGroup<T>[] {
  const today = new Date(now);
  const todayKey = localDayKey(today);
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );
  const yesterdayKey = localDayKey(yesterday);

  const groups: DayGroup<T>[] = [];
  for (const entry of entries) {
    const d = new Date(entry.created_at);
    const key = Number.isNaN(d.getTime()) ? "unknown" : localDayKey(d);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const label =
        key === "unknown"
          ? "Unknown date"
          : key === todayKey
            ? "Today"
            : key === yesterdayKey
              ? "Yesterday"
              : d.toLocaleDateString(locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year:
                    d.getFullYear() === today.getFullYear()
                      ? undefined
                      : "numeric",
                });
      group = { key, label, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}
