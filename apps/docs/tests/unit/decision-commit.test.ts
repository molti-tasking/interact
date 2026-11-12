/**
 * G4 — no change without a decision, checked where it is enforced.
 *
 * 1. `commitPortfolioChange` is the only way a form is written. With a
 *    stubbed database: a form change needs a creator's action, an actor and
 *    a rationale, or nothing is written.
 * 2. A census of every call site: each declares what triggers it. A new
 *    call site fails this test until it is added to the table — which is
 *    the point: someone has to say what the creator did.
 * 3. Background work (curation, conflict detection, findings, intent sync)
 *    never writes the form.
 */
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Field, PortfolioSchema } from "@/lib/types";

// ---------------------------------------------------------------------------
// 1. The commit, with a stubbed database
// ---------------------------------------------------------------------------

const field = (name: string): Field => ({
  id: `f-${name}`,
  name,
  label: name,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});

const baseSchema: PortfolioSchema = { fields: [field("name")], groups: [], version: 1 };
const withAge: PortfolioSchema = { ...baseSchema, fields: [field("name"), field("age")] };

const intent = {
  purpose: { content: "Register members", updatedAt: "2026-01-01T00:00:00.000Z" },
  audience: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
  exclusions: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
  constraints: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
};

function row(schema: PortfolioSchema, revision = 1) {
  return {
    id: "p1",
    title: "Members",
    status: "draft",
    intent,
    schema,
    revision,
    base_id: null,
    space_id: null,
    projection: null,
    field_count: schema.fields.length,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: row(baseSchema), error: null }) }),
      }),
    }),
    rpc,
  }),
}));

const by = { layer: "dimensions" as const, action: "test", actor: "Ada", rationale: "Asked for age" };

describe("G4: the commit refuses a form change without a decision", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (_name: string, args: { p_schema?: PortfolioSchema }) => ({
      data: [row(args.p_schema ?? baseSchema, 2)],
      error: null,
    }));
  });

  it("writes a creator's change with its actor and rationale", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    const result = await commitPortfolioChange("p1", () => ({
      trigger: "answer",
      schema: withAge,
      provenance: by,
    }));
    expect(result?.portfolio.schema.fields).toHaveLength(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("commit_portfolio_change");
    expect(args.p_provenance).toMatchObject({ actor: "Ada", rationale: "Asked for age" });
    expect(args.p_provenance.diff.added).toHaveLength(1);
  });

  it("writes nothing when background work would change the form", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    await expect(
      commitPortfolioChange("p1", () => ({
        trigger: "background",
        schema: withAge,
        provenance: by,
      })),
    ).rejects.toThrow(/Refused to change the form/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("writes nothing for a form change without an actor, a rationale or an entry", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    const attempts = [
      { ...by, actor: "system" },
      { ...by, rationale: "" },
      { ...by, rationale: undefined },
      null,
      undefined,
    ];
    for (const provenance of attempts) {
      await expect(
        commitPortfolioChange("p1", () => ({ trigger: "field-edit", schema: withAge, provenance })),
      ).rejects.toThrow(/Refused to change the form/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets background work write the intent text, and a response dashboard", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    await commitPortfolioChange("p1", () => ({
      trigger: "background",
      intent: { ...intent, purpose: { content: "Register members and their age", updatedAt: "x" } },
      provenance: { ...by, layer: "intent", actor: "system" },
    }));
    await commitPortfolioChange("p1", () => ({
      trigger: "background",
      schema: { ...baseSchema, dashboard: { widgets: [] } },
      provenance: { ...by, layer: "configuration", actor: "system" },
    }));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_schema).toBeUndefined();
  });

  it("records an undo with the person who undid it", async () => {
    const { commitPortfolioChange, revertCommit, restoreSnapshot } = await import(
      "@/lib/engine/commit"
    );
    const applied = await commitPortfolioChange("p1", () => ({
      trigger: "answer",
      schema: withAge,
      provenance: by,
    }));
    // The stub always reads revision 1; make the applied state match it
    const result = { ...applied!, portfolio: { ...applied!.portfolio, revision: 1 } };
    rpc.mockClear();
    await revertCommit(result, "Ada", "Asked for age");
    await restoreSnapshot("p1", { schema: withAge, intent: null }, "Ada", "Back to yesterday");
    for (const [, args] of rpc.mock.calls) {
      expect(args.p_provenance.actor).toBe("Ada");
      expect(args.p_provenance.rationale).toBeTruthy();
    }
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Census of the call sites
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: fs.readFileSync(file, "utf-8"),
}));

/**
 * Every write of a portfolio's schema or intent, by file, with the trigger
 * each declares (in source order) and the creator action behind it.
 */
const COMMIT_SITES: Record<string, string[]> = {
  // Undo of a committed change; restoring a point in the history
  "lib/engine/commit.ts": ["undo", "undo"],
  // Answering a question from its preview (the change; committed by the deck)
  "lib/engine/answer-change.ts": ["answer"],
  // Undoing an applied answer or fix
  "hooks/query/design-probes.ts": ["undo"],
  // Choosing a fix on a conflict card (previewed fix)
  "hooks/query/conflicts.ts": ["answer"],
  // Accepting a domain standard
  "hooks/query/standards.ts": ["answer"],
  // Editing the intent: exclusions applied, intent saved
  "hooks/query/pipeline.ts": ["intent-edit", "intent-edit"],
  // The form generated or refined for an intent the creator wrote
  "hooks/query/schema-generation.ts": ["intent-edit", "intent-edit"],
  // Editing, removing and adding fields on the canvas
  "components/workspace/PortfolioWorkspace.tsx": ["field-edit", "field-edit", "field-edit"],
  // Sections and field order
  "components/workspace/ArtifactPane.tsx": ["field-edit", "field-edit"],
  // A typed change request (baseline condition)
  "components/workspace/ChatEditPane.tsx": ["request"],
  // A spoken change request
  "hooks/voice/useUtteranceProcessor.ts": ["request"],
  // A column action saved from the response table
  "app/(app)/responses/[portfolioId]/_components/column-prompt-dialog.tsx": ["field-edit"],
  // Recoding responses (may change a field's options)
  "hooks/query/recode.ts": ["field-edit"],
  // The first description in study mode (intent only)
  "app/(study)/study/[sessionId]/_components/create-view.tsx": ["intent-edit"],
  // A derived form's first trail entry (no form change)
  "hooks/query/portfolios.ts": ["derive"],
  // Editing the response dashboard — and suggesting one, unasked
  "hooks/query/dashboard.ts": ["background", "field-edit"],
  // Keeping the intent text in step after an edit or an answer
  "hooks/query/intent-backpropagation.ts": ["background"],
};

/** Triggers declared in a file's change objects (not the type definition). */
function declaredTriggers(text: string): string[] {
  return [...text.matchAll(/\btrigger: "([a-z-]+)"/g)].map((m) => m[1]);
}

describe("G4: every write of a form says what the creator did", () => {
  it("matches the census — a new call site must be classified here", () => {
    const found: Record<string, string[]> = {};
    for (const { file, text } of files) {
      const triggers = declaredTriggers(text);
      if (triggers.length) found[file] = triggers;
    }
    expect(found).toEqual(COMMIT_SITES);
  });

  it("has no call site outside the census", () => {
    const callers = files
      .filter(({ text }) =>
        /\bcommitPortfolioChange\(|\buseCommitPortfolio\(|\brevertCommit\(|\brestoreSnapshot\(/.test(text),
      )
      .map(({ file }) => file)
      // Callers that only pass a change on (their change functions are
      // declared, and counted, where they are written)
      .filter(
        (file) =>
          !["hooks/query/undo.ts", "app/(app)/portfolios/[id]/provenance/page.tsx"].includes(file),
      );
    for (const file of callers) expect(Object.keys(COMMIT_SITES)).toContain(file);
  });

  it("writes schema and intent nowhere else", () => {
    for (const { file, text } of files) {
      // The commit itself, and the generated database types
      if (["lib/engine/commit.ts", "lib/supabase/database.types.ts"].includes(file)) continue;
      expect(text, file).not.toMatch(/commit_portfolio_change/);
    }
    // Direct updates of the portfolios table carry metadata only
    const direct = files.filter(({ text }) => /\.from\("portfolios"\)\s*\.update\(/.test(text));
    expect(direct.map((f) => f.file)).toEqual(["hooks/query/portfolios.ts"]);
    const update = direct[0].text;
    const body = update.slice(update.indexOf("export function useUpdatePortfolio"));
    expect(body).toMatch(/Omit<PortfolioUpdate, "schema" \| "intent">/);
    expect(body.slice(0, body.indexOf(".update("))).not.toMatch(/dbUpdate\.(schema|intent)\b/);
  });

  it("names a person at every creator-triggered site", () => {
    for (const file of Object.keys(COMMIT_SITES)) {
      const text = files.find((f) => f.file === file)!.text;
      // The two background writers are the only ones that record "system"
      const system = /actor: "system"/.test(text);
      expect(system, file).toBe(
        ["hooks/query/dashboard.ts", "hooks/query/intent-backpropagation.ts"].includes(file),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Background work
// ---------------------------------------------------------------------------

describe("G4: background work never writes the form", () => {
  const text = (file: string) => files.find((f) => f.file === file)!.text;

  /** The source of one exported function, up to the next export. */
  function body(file: string, name: string): string {
    const source = text(file);
    const start = source.indexOf(`export function ${name}`);
    expect(start, `${name} in ${file}`).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next < 0 ? undefined : next);
  }

  it("curation retires, re-ranks and adds questions — no commit", () => {
    for (const name of ["useCurateDesignProbes", "useAutoCurateProbes"]) {
      expect(body("hooks/query/design-probes.ts", name)).not.toMatch(/commitPortfolioChange|trigger:/);
    }
  });

  it("working out previews writes to the question, not the form", () => {
    for (const name of ["usePrecomputeProbePreviews", "usePreviewOwnAnswer", "useAskProbeAgain"]) {
      expect(body("hooks/query/design-probes.ts", name)).not.toMatch(/commitPortfolioChange|trigger:/);
    }
  });

  it("conflict detection and its fix previews only read", () => {
    for (const name of ["useDetectConflicts", "useConflictFixPreviews"]) {
      expect(body("hooks/query/conflicts.ts", name)).not.toMatch(/commitPortfolioChange|trigger:/);
    }
  });

  it("findings, themes and pretests create cards at most", () => {
    for (const file of ["hooks/query/answer-themes.ts", "hooks/query/pretest.ts"]) {
      expect(text(file)).not.toMatch(/commitPortfolioChange|useCommitPortfolio/);
    }
    for (const name of ["useSendFindingToDeck", "useSendPretestIssueToDeck", "useInsertStandardProbes"]) {
      expect(body("hooks/query/design-probes.ts", name)).not.toMatch(/commitPortfolioChange|trigger:/);
    }
  });

  it("intent sync writes the purpose text only", () => {
    const sync = text("hooks/query/intent-backpropagation.ts");
    const from = sync.indexOf('trigger: "background"');
    const change = sync.slice(from, sync.indexOf("applyCommitToCache", from));
    expect(change).toMatch(/intent:/);
    expect(change).not.toMatch(/\bschema\b/);
  });

  it("the suggested dashboard touches the dashboard only", () => {
    const dashboard = text("hooks/query/dashboard.ts");
    const from = dashboard.indexOf('trigger: "background"');
    const change = dashboard.slice(from, dashboard.indexOf("onSuccess", from));
    expect(change).toMatch(/\.\.\.current\.schema,\s*dashboard:/);
  });
});
