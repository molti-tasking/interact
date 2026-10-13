/**
 * Form sections: titled parts of a form ("About you", "Usability",
 * "Feedback"), stored as `schema.groups`. Respondents see them as headings,
 * or one per page when `schema.layout` is "paged".
 *
 * Invariant kept by every edit here: a field is in at most one section, and
 * `schema.fields` lists each section's fields together, in section order,
 * after the fields that aren't in any section. So the form, the responses
 * table and the LLM all see the same order.
 */

import type { Field, FieldGroup, PortfolioSchema } from "../types";

export interface SectionBlock {
  /** null for the fields before the first section */
  section: FieldGroup | null;
  fields: Field[];
}

export function newSectionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `section-${uuid}`
    : `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The section a field is in, if any. */
export function sectionOf(
  schema: PortfolioSchema,
  fieldId: string,
): FieldGroup | undefined {
  return schema.groups.find((g) => g.fieldIds.includes(fieldId));
}

/** The form as respondents see it: unsectioned fields first, then each section. */
export function sectionBlocks(schema: PortfolioSchema): SectionBlock[] {
  const owner = new Map<string, string>();
  for (const g of schema.groups) {
    for (const id of g.fieldIds) if (!owner.has(id)) owner.set(id, g.id);
  }
  const loose = schema.fields.filter((f) => !owner.has(f.id));
  const blocks: SectionBlock[] = loose.length ? [{ section: null, fields: loose }] : [];
  for (const section of schema.groups) {
    const fields = schema.fields.filter((f) => owner.get(f.id) === section.id);
    if (fields.length) blocks.push({ section, fields });
  }
  return blocks;
}

/**
 * Restore the invariant: one section per field, no empty sections, fields
 * ordered by section (relative order within a section is kept).
 */
export function normalizeSections(schema: PortfolioSchema): PortfolioSchema {
  const existing = new Set(schema.fields.map((f) => f.id));
  const claimed = new Set<string>();
  const groups = schema.groups
    .map((g) => ({
      ...g,
      fieldIds: g.fieldIds.filter((id) => {
        if (!existing.has(id) || claimed.has(id)) return false;
        claimed.add(id);
        return true;
      }),
    }))
    .filter((g) => g.fieldIds.length > 0);
  const normalized = { ...schema, groups };
  const fields = sectionBlocks(normalized).flatMap((b) => b.fields);
  return { ...normalized, fields };
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Put a field into the section titled `title` — at its end; the section is
 * created after the others when there's none — or out of any section with null.
 */
export function assignSection(
  schema: PortfolioSchema,
  fieldId: string,
  title: string | null,
): PortfolioSchema {
  const without = schema.groups.map((g) => ({
    ...g,
    fieldIds: g.fieldIds.filter((id) => id !== fieldId),
  }));
  const name = title?.trim();
  if (!name) return normalizeSections({ ...schema, groups: without });

  const target = without.find((g) => sameTitle(g.label, name));
  const groups = target
    ? without.map((g) => (g === target ? { ...g, fieldIds: [...g.fieldIds, fieldId] } : g))
    : [...without, { id: newSectionId(), label: name, fieldIds: [fieldId] }];
  // The field joins at the end of its section
  const others = schema.fields.filter((f) => f.id !== fieldId);
  const moved = schema.fields.find((f) => f.id === fieldId);
  return normalizeSections({
    ...schema,
    fields: moved ? [...others, moved] : schema.fields,
    groups,
  });
}

export function updateSection(
  schema: PortfolioSchema,
  sectionId: string,
  changes: { label?: string; description?: string },
): PortfolioSchema {
  return {
    ...schema,
    groups: schema.groups.map((g) =>
      g.id === sectionId
        ? {
            ...g,
            ...(changes.label?.trim() ? { label: changes.label.trim() } : {}),
            ...(changes.description !== undefined
              ? { description: changes.description.trim() || undefined }
              : {}),
          }
        : g,
    ),
  };
}

/** Move a section up (-1) or down (+1); its fields move with it. */
export function moveSection(
  schema: PortfolioSchema,
  sectionId: string,
  delta: -1 | 1,
): PortfolioSchema {
  const index = schema.groups.findIndex((g) => g.id === sectionId);
  const to = index + delta;
  if (index === -1 || to < 0 || to >= schema.groups.length) return schema;
  const groups = [...schema.groups];
  [groups[index], groups[to]] = [groups[to], groups[index]];
  return normalizeSections({ ...schema, groups });
}

/** Dissolve a section; its fields stay in the form, outside any section. */
export function removeSection(schema: PortfolioSchema, sectionId: string): PortfolioSchema {
  return normalizeSections({
    ...schema,
    groups: schema.groups.filter((g) => g.id !== sectionId),
  });
}

/**
 * Build sections from field → title assignments (LLM output), with
 * descriptions by title. Sections appear in order of their first field.
 */
export function sectionsFromTitles(
  schema: PortfolioSchema,
  titleOf: (field: Field) => string | undefined,
  descriptions: { title: string; description: string }[] = [],
): PortfolioSchema {
  const groups: FieldGroup[] = [];
  for (const field of schema.fields) {
    const title = titleOf(field)?.trim();
    if (!title) continue;
    let group = groups.find((g) => sameTitle(g.label, title));
    if (!group) {
      const description = descriptions
        .find((d) => sameTitle(d.title, title))
        ?.description.trim();
      group = {
        id: newSectionId(),
        label: title,
        ...(description ? { description } : {}),
        fieldIds: [],
      };
      groups.push(group);
    }
    group.fieldIds.push(field.id);
  }
  return normalizeSections({ ...schema, groups });
}
