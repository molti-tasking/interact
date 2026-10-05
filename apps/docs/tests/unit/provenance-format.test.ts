import { describe, expect, it } from "vitest";
import {
  describeFieldChanges,
  fieldDisplayName,
  formatFieldType,
  formatProvenanceAction,
  formatRelativeTime,
  groupByDay,
  parseActor,
  sentenceCase,
  summarizeDiff,
} from "@/lib/provenance-format";
import type { Field } from "@/lib/types";

describe("formatProvenanceAction", () => {
  it.each([
    ["schema_generated", "Generated the form from the intent"],
    ["design_probe_resolved", "Answered a design probe"],
    ["design_probe_re_resolved", "Changed a design probe answer"],
    ["snapshot_restored", "Restored an earlier version"],
    ["change_reverted", "Undid a change"],
    ["voice_edit", "Edited the form by voice"],
  ])("%s", (action, label) => {
    expect(formatProvenanceAction(action)).toBe(label);
  });

  it("labels unknown voice actions", () => {
    expect(formatProvenanceAction("voice_field_added")).toBe("Field added (by voice)");
  });

  it("falls back to sentence case", () => {
    expect(formatProvenanceAction("some_new_action")).toBe("Some new action");
    expect(formatProvenanceAction("")).toBe("Change");
  });

  it("does not resolve prototype keys", () => {
    expect(formatProvenanceAction("constructor")).toBe("Constructor");
  });
});

describe("sentenceCase", () => {
  it("handles snake, kebab and camel case", () => {
    expect(sentenceCase("field_added")).toBe("Field added");
    expect(sentenceCase("clientName")).toBe("Client name");
    expect(sentenceCase("tax-exempt")).toBe("Tax exempt");
  });
});

describe("parseActor", () => {
  it("splits name and role", () => {
    expect(parseActor("Alex (Coach)")).toEqual({
      key: "Alex (Coach)",
      name: "Alex",
      role: "Coach",
      isSystem: false,
    });
    expect(parseActor("  Dr. Park   (Lead Orthopedic Surgeon) ").name).toBe("Dr. Park");
  });

  it("recognises the system actor", () => {
    expect(parseActor("system")).toMatchObject({ key: "system", isSystem: true });
    expect(parseActor("System").isSystem).toBe(true);
  });

  it("handles legacy and empty actors", () => {
    expect(parseActor("creator")).toMatchObject({ name: "Creator", role: null });
    expect(parseActor("")).toMatchObject({ key: "unknown" });
    expect(parseActor(null)).toMatchObject({ key: "unknown" });
  });

  it("groups the same person consistently", () => {
    expect(parseActor("Alex  (Coach)").key).toBe(parseActor("Alex (Coach)").key);
  });
});

const field = (overrides: Partial<Field> = {}): Field => ({
  id: "f1",
  name: "age_group",
  label: "Age group",
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
  ...overrides,
});

describe("fieldDisplayName", () => {
  it("prefers label, then a humanised name, then id", () => {
    expect(fieldDisplayName(field())).toBe("Age group");
    // seeded provenance diffs may only contain a name
    expect(fieldDisplayName({ name: "purchaseOrderNumber" })).toBe("Purchase order number");
    expect(fieldDisplayName({ id: "x" })).toBe("x");
    expect(fieldDisplayName(undefined)).toBe("Unnamed field");
  });
});

describe("formatFieldType", () => {
  it("describes common types", () => {
    expect(formatFieldType({ kind: "text" })).toBe("Text");
    expect(
      formatFieldType({
        kind: "select",
        multiple: false,
        options: [
          { label: "U8", value: "u8" },
          { label: "U10", value: "u10" },
        ],
      }),
    ).toBe("Select · 2 options");
    expect(formatFieldType({ kind: "scale", min: 1, max: 5 })).toBe("Scale 1–5");
    expect(formatFieldType(undefined)).toBe("");
  });
});

describe("describeFieldChanges", () => {
  it("lists changed label, type and required flag", () => {
    const changes = describeFieldChanges(
      field(),
      field({
        label: "Age bracket",
        required: true,
        type: { kind: "select", multiple: false, options: [{ label: "U8", value: "u8" }] },
      }),
    );
    expect(changes).toEqual([
      { property: "Label", before: "Age group", after: "Age bracket" },
      { property: "Type", before: "Text", after: "Select · 1 option" },
      { property: "Required", before: "No", after: "Yes" },
      { property: "Options", before: "—", after: "U8" },
    ]);
  });

  it("reports option changes within a select", () => {
    const sel = (labels: string[]) =>
      field({
        type: {
          kind: "select",
          multiple: false,
          options: labels.map((l) => ({ label: l, value: l.toLowerCase() })),
        },
      });
    const changes = describeFieldChanges(sel(["A", "B"]), sel(["A", "C"]));
    expect(changes).toContainEqual({ property: "Options", before: "A, B", after: "A, C" });
  });

  it("falls back to a generic entry for untracked changes", () => {
    expect(describeFieldChanges(field({ tags: [] }), field({ tags: ["pii"] }))).toEqual([
      { property: "Other settings", before: "changed", after: "changed" },
    ]);
  });

  it("returns nothing for identical fields", () => {
    expect(describeFieldChanges(field(), field())).toEqual([]);
  });
});

describe("summarizeDiff", () => {
  it("counts and tolerates missing parts", () => {
    expect(summarizeDiff({ added: [field()], removed: ["a", "b"], modified: [] })).toEqual({
      added: 1,
      removed: 2,
      modified: 0,
      total: 3,
    });
    expect(summarizeDiff(undefined).total).toBe(0);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 9, 5, 12, 0, 0).getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("formats recent times relatively", () => {
    expect(formatRelativeTime(ago(10_000), now, "en")).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60_000), now, "en")).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(3 * 3_600_000), now, "en")).toBe("3 hours ago");
    expect(formatRelativeTime(ago(2 * 86_400_000), now, "en")).toBe("2 days ago");
  });

  it("falls back to a date for old entries and handles bad input", () => {
    expect(formatRelativeTime(ago(30 * 86_400_000), now, "en")).toMatch(/2026/);
    expect(formatRelativeTime("not a date", now)).toBe("");
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 9, 5, 12, 0, 0).getTime();
  const at = (y: number, m: number, d: number, h = 9) =>
    new Date(y, m, d, h).toISOString();

  it("groups consecutive entries by local day with friendly labels", () => {
    const entries = [
      { id: 1, created_at: at(2026, 9, 5, 11) },
      { id: 2, created_at: at(2026, 9, 5, 8) },
      { id: 3, created_at: at(2026, 9, 4) },
      { id: 4, created_at: at(2026, 8, 1) },
    ];
    const groups = groupByDay(entries, now, "en-GB");
    expect(groups.map((g) => g.label).slice(0, 2)).toEqual(["Today", "Yesterday"]);
    expect(groups[2].label).toMatch(/Tuesday.*September/);
    expect(groups[2].label).not.toMatch(/2026/); // same year → no year
    expect(groups[0].entries.map((e) => e.id)).toEqual([1, 2]);
    expect(groups[2].key).toBe("2026-09-01");
  });
});
