/**
 * G4 — no change without a decision: the form changes only through a
 * creator's action, recorded with who decided and why.
 */
import { describe, expect, it } from "vitest";
import {
  checkCommit,
  CREATOR_TRIGGERS,
  formChanged,
  isCreatorTrigger,
} from "../src/forms/decision-guard";
import { field, schema } from "./helpers";

const by = { actor: "Ada (designer)", rationale: '"Collect age?" → "Yes"' };

describe("G4: what counts as a change to the form", () => {
  const form = schema("name", "email");

  it("a field added, removed, changed or moved", () => {
    expect(formChanged(form, { ...form, fields: [...form.fields, field("age")] })).toBe(true);
    expect(formChanged(form, { ...form, fields: form.fields.slice(1) })).toBe(true);
    expect(
      formChanged(form, {
        ...form,
        fields: [{ ...form.fields[0], required: true }, form.fields[1]],
      }),
    ).toBe(true);
    expect(formChanged(form, { ...form, fields: [...form.fields].reverse() })).toBe(true);
  });

  it("a section, an accepted standard or the page layout", () => {
    expect(
      formChanged(form, {
        ...form,
        groups: [{ id: "g1", label: "Contact", fieldIds: ["f-email"] }],
      }),
    ).toBe(true);
    expect(
      formChanged(form, {
        ...form,
        acceptedStandards: [{ standardId: "s", standardName: "S", domain: "d" }],
      }),
    ).toBe(true);
    expect(formChanged(form, { ...form, layout: "paged" })).toBe(true);
  });

  it("not the version counter, the response dashboard, column actions or respondent help", () => {
    expect(formChanged(form, { ...form, version: 9 })).toBe(false);
    expect(formChanged(form, { ...form, dashboard: { widgets: [] } })).toBe(false);
    expect(formChanged(form, { ...form, columnActions: [] })).toBe(false);
    expect(formChanged(form, JSON.parse(JSON.stringify(form)))).toBe(false);
  });

  it("not the order of properties", () => {
    const [name, email] = form.fields;
    const reordered = { required: name.required, ...name };
    expect(formChanged(form, { version: 1, groups: [], fields: [reordered, email] })).toBe(false);
  });
});

describe("G4: a form change needs a creator's action, an actor and a rationale", () => {
  it("accepts every creator action when it is recorded", () => {
    for (const trigger of CREATOR_TRIGGERS) {
      expect(checkCommit({ trigger, formChanged: true, provenance: by })).toEqual({ ok: true });
    }
  });

  it("covers the actions the paper names", () => {
    for (const trigger of ["answer", "intent-edit", "field-edit", "undo", "derive"]) {
      expect(isCreatorTrigger(trigger)).toBe(true);
    }
    expect(isCreatorTrigger("background")).toBe(false);
  });

  it("refuses background work that would change the form, however it is recorded", () => {
    const verdict = checkCommit({ trigger: "background", formChanged: true, provenance: by });
    expect(verdict.ok).toBe(false);
  });

  it("refuses a change with no stated trigger", () => {
    expect(checkCommit({ trigger: undefined, formChanged: true, provenance: by }).ok).toBe(false);
  });

  it("refuses a change without a provenance entry", () => {
    for (const provenance of [undefined, null]) {
      expect(checkCommit({ trigger: "answer", formChanged: true, provenance }).ok).toBe(false);
    }
  });

  it("refuses a change recorded without a person", () => {
    for (const actor of ["", "  ", "system", "System", "llm", null, undefined]) {
      const verdict = checkCommit({
        trigger: "answer",
        formChanged: true,
        provenance: { ...by, actor },
      });
      expect(verdict.ok, String(actor)).toBe(false);
    }
  });

  it("refuses a change recorded without a rationale", () => {
    for (const rationale of ["", "   ", null, undefined]) {
      const verdict = checkCommit({
        trigger: "field-edit",
        formChanged: true,
        provenance: { ...by, rationale },
      });
      expect(verdict.ok).toBe(false);
    }
  });

  it("lets background work write what is not the form (the intent text)", () => {
    expect(
      checkCommit({
        trigger: "background",
        formChanged: false,
        provenance: { actor: "system", rationale: "Purpose updated after field edits" },
      }),
    ).toEqual({ ok: true });
    expect(checkCommit({ trigger: "background", formChanged: false }).ok).toBe(true);
  });
});
