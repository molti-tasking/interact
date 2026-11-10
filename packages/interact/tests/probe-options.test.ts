/**
 * G2 — alternatives, not a recommendation: every question has exactly one
 * answer that leaves the form unchanged, and its answers are shown in a
 * random order that is drawn once and stored.
 * G3 — consequences before commitment: an answer is committed only when
 * its preview was on screen (`answerGate`).
 */
import { describe, expect, it } from "vitest";
import { composeProbes, type DisagreementOp } from "../src/forms/probe-disagreement";
import {
  answerGate,
  ensureUnchangedOption,
  leavesFormUnchanged,
  mergeOptionPreviews,
  prepareProbeOptions,
  seededRandom,
  UNCHANGED_LABEL,
  UNCHANGED_VALUE,
} from "../src/forms/probe-options";
import type { DesignProbeOption } from "../src/forms/types";
import { adds, bare, schema } from "./helpers";

const form = schema("name", "email");
const unchangedOf = (options: DesignProbeOption[]) =>
  options.filter((o) => leavesFormUnchanged(o, form));

describe("G2: exactly one answer leaves the form unchanged", () => {
  it("adds it when the model left it out (prompted path: no previews yet)", () => {
    const options = ensureUnchangedOption([bare("yes"), bare("no")]);
    expect(options.map((o) => o.value)).toEqual(["yes", "no", UNCHANGED_VALUE]);
    const added = options[2];
    expect(added).toMatchObject({ label: UNCHANGED_LABEL, unchanged: true, modelPosition: null });
    expect(added.preview?.schemaPatch).toEqual({});
  });

  it("adds it when every previewed answer changes the form (committee path)", () => {
    const options = ensureUnchangedOption([adds("a", "age"), adds("b", "phone")], form);
    expect(unchangedOf(options)).toHaveLength(1);
    expect(options.at(-1)?.unchanged).toBe(true);
  });

  it("marks the model's own no-change answer instead of adding a second", () => {
    const keep: DesignProbeOption = {
      value: "leaveIt",
      label: "Leave it",
      preview: { summary: "No form change", schemaPatch: {} },
    };
    const options = ensureUnchangedOption([adds("a", "age"), keep], form);
    expect(options).toHaveLength(2);
    expect(options[1]).toMatchObject({ value: "leaveIt", unchanged: true });
  });

  it("drops further answers that change nothing, keeping the marked one", () => {
    const noop = (value: string): DesignProbeOption => ({
      value,
      label: value,
      preview: { summary: "No form change", schemaPatch: {} },
    });
    const options = ensureUnchangedOption(
      [noop("first"), adds("a", "age"), { ...noop("marked"), unchanged: true }, noop("third")],
      form,
    );
    expect(options.map((o) => o.value)).toEqual(["a", "marked"]);
  });

  it("sees through a patch that is not empty but changes nothing on this form", () => {
    // Removing a field the form doesn't have
    const phantom: DesignProbeOption = {
      value: "dropFax",
      label: "Drop the fax number",
      preview: { summary: "Removes fax", schemaPatch: { removeFieldKeys: ["fax"] } },
    };
    expect(leavesFormUnchanged(phantom)).toBe(false); // without the form: unknown
    expect(leavesFormUnchanged(phantom, form)).toBe(true);
    const options = ensureUnchangedOption([adds("a", "age"), phantom], form);
    expect(unchangedOf(options)).toHaveLength(1);
  });

  it("never reuses a value the model already used", () => {
    const options = ensureUnchangedOption([bare(UNCHANGED_VALUE, "Keep it short"), bare("no")]);
    const values = options.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(options.filter((o) => o.unchanged)).toHaveLength(1);
  });

  it("is stable: running it again changes nothing", () => {
    const once = ensureUnchangedOption([adds("a", "age"), bare("b")], form);
    expect(ensureUnchangedOption(once, form)).toEqual(once);
  });

  it("holds for any mix of answers", () => {
    const random = seededRandom("mix");
    for (let run = 0; run < 200; run++) {
      const options: DesignProbeOption[] = [];
      const count = 1 + Math.floor(random() * 5);
      for (let i = 0; i < count; i++) {
        const kind = random();
        options.push(
          kind < 0.4
            ? adds(`o${i}`, `field${i}`)
            : kind < 0.6
              ? { value: `o${i}`, label: "noop", preview: { summary: "", schemaPatch: {} } }
              : kind < 0.7
                ? { ...bare(`o${i}`), unchanged: true }
                : bare(`o${i}`),
        );
      }
      const prepared = prepareProbeOptions(options, { schema: form, random });
      expect(unchangedOf(prepared), JSON.stringify(options)).toHaveLength(1);
      expect(prepared.filter((o) => o.unchanged)).toHaveLength(1);
      expect(new Set(prepared.map((o) => o.value)).size).toBe(prepared.length);
    }
  });

  it("holds when previews arrive later for a stored question", () => {
    const stored = prepareProbeOptions([bare("yes"), bare("noThanks")], {
      random: seededRandom("s"),
    });
    // The model's "noThanks" turns out to change nothing
    const previewed: DesignProbeOption[] = [
      { ...adds("yes", "age") },
      { value: "noThanks", label: "noThanks", preview: { summary: "No change", schemaPatch: {} } },
    ];
    const merged = mergeOptionPreviews(stored, previewed, form);
    expect(unchangedOf(merged)).toHaveLength(1);
    expect(merged.find((o) => o.unchanged)?.value).toBe(UNCHANGED_VALUE);
    expect(merged.map((o) => o.value)).not.toContain("noThanks");
    // The answers that stay keep their stored order
    const order = stored.map((o) => o.value).filter((v) => v !== "noThanks");
    expect(merged.map((o) => o.value)).toEqual(order);
    expect(merged.every((o) => o.preview)).toBe(true);
  });

  it("holds for committee questions, also when the model offers many answers", () => {
    const op = (ref: string, key: string): DisagreementOp => ({
      ref,
      kind: "add",
      key,
      label: key,
      votes: 2,
      voters: 4,
      entropy: 1,
      summary: `add ${key}`,
      patch: { addFields: [{ key, label: key, type: "string", required: false }] },
    });
    const ops = ["a1", "a2", "a3", "a4", "a5"].map((ref, i) => op(ref, `extra${i}`));
    const [withKeep] = composeProbes(
      form,
      ops,
      [
        {
          text: "Which extras?",
          // Five changing answers and no unchanged one
          options: ops.map((o, i) => ({ value: `v${i}`, label: `Extra ${i}`, ops: [o.ref] })),
        },
      ],
      5,
    );
    expect(withKeep.options.length).toBeLessThanOrEqual(4);
    expect(unchangedOf(withKeep.options)).toHaveLength(1);
    expect(withKeep.options.every((o) => o.preview)).toBe(true);
  });
});

describe("G2: the display order is random, drawn once, and stored", () => {
  const model = ["a", "b", "c", "d"].map((v) => bare(v));

  it("keeps every answer and remembers where the model had it", () => {
    const prepared = prepareProbeOptions(model, { random: seededRandom("x") });
    expect(prepared.map((o) => o.value).sort()).toEqual(["a", "b", "c", "d", UNCHANGED_VALUE].sort());
    for (const option of prepared) {
      if (option.unchanged) expect(option.modelPosition).toBeNull();
      else expect(model[option.modelPosition as number].value).toBe(option.value);
    }
  });

  it("is reproducible from a seed and differs between seeds", () => {
    const order = (seed: string) =>
      prepareProbeOptions(model, { random: seededRandom(seed) }).map((o) => o.value);
    expect(order("one")).toEqual(order("one"));
    const orders = new Set(["1", "2", "3", "4", "5", "6", "7", "8"].map((s) => order(s).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("is drawn once: answers that were ordered before are not reordered", () => {
    const first = prepareProbeOptions(model, { random: seededRandom("first") });
    const again = prepareProbeOptions(first, { random: seededRandom("another") });
    expect(again).toEqual(first);
  });

  it("puts each answer in each position about equally often", () => {
    const random = seededRandom("uniform");
    const runs = 6000;
    // counts[modelPosition][displayPosition]
    const counts = [0, 1, 2].map(() => [0, 0, 0, 0]);
    let unchangedFirst = 0;
    for (let i = 0; i < runs; i++) {
      const prepared = prepareProbeOptions(model.slice(0, 3), { random });
      prepared.forEach((o, position) => {
        if (o.unchanged) unchangedFirst += position === 0 ? 1 : 0;
        else counts[o.modelPosition as number][position]++;
      });
    }
    const expected = runs / 4;
    for (const row of counts) {
      for (const n of row) expect(Math.abs(n - expected)).toBeLessThan(expected * 0.12);
    }
    // The unchanged answer is shuffled in with the others, not pinned
    expect(Math.abs(unchangedFirst - expected)).toBeLessThan(expected * 0.12);
  });

  it("marks no answer as preferred: nothing but value, label, preview and bookkeeping", () => {
    const prepared = prepareProbeOptions([adds("a", "age"), bare("b")], {
      schema: form,
      random: seededRandom("k"),
    });
    for (const option of prepared) {
      expect(Object.keys(option).sort()).toEqual(
        expect.arrayContaining(["label", "modelPosition", "value"]),
      );
      for (const key of Object.keys(option)) {
        expect(["value", "label", "preview", "unchanged", "modelPosition"]).toContain(key);
      }
    }
  });
});

describe("G3: an answer is committed only after its preview was shown", () => {
  const statuses = ["pending", "ready", "failed", null] as const;

  it("applies an answer whose preview was on screen", () => {
    expect(answerGate({ hasPreview: true, previewShown: true, previewStatus: "ready" })).toBe("apply");
  });

  it("waits for a preview that is still being worked out", () => {
    expect(answerGate({ hasPreview: false, previewShown: false, previewStatus: "pending" })).toBe(
      "await-preview",
    );
  });

  it("shows a preview that exists but was not on screen, instead of applying", () => {
    expect(answerGate({ hasPreview: true, previewShown: false, previewStatus: "ready" })).toBe(
      "show-preview",
    );
  });

  it("refuses an answer whose preview failed", () => {
    expect(answerGate({ hasPreview: false, previewShown: false, previewStatus: "failed" })).toBe(
      "unavailable",
    );
  });

  it("never applies without a preview that was shown, whatever the state", () => {
    for (const previewStatus of statuses) {
      for (const hasPreview of [true, false]) {
        for (const previewShown of [true, false]) {
          const gate = answerGate({ hasPreview, previewShown, previewStatus });
          if (gate === "apply") expect(hasPreview && previewShown).toBe(true);
        }
      }
    }
    // A claim that the preview was shown doesn't help when there is none
    for (const previewStatus of statuses) {
      expect(answerGate({ hasPreview: false, previewShown: true, previewStatus })).not.toBe("apply");
    }
  });
});
