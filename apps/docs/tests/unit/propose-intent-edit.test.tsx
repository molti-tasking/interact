/**
 * 1E: an intent edit's changes to the form become a question, not a write.
 * The model's refinement patch is stored as "Apply these changes from your
 * edit?" with a ready, scoped preview and a keep-as-is answer; an earlier
 * edit's open question is withdrawn; nothing touches the form.
 */
import { useProposeIntentEdit } from "@/hooks/query/design-probes";
import type { Field, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { INTENT_EDIT_QUESTION, INTENT_EDIT_SOURCE } from "interact/forms/intent-refinement";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refine = vi.fn();
vi.mock("@/app/actions/schema-actions", () => ({
  refineSchemaFromIntentAction: (...args: unknown[]) => refine(...args),
}));

const updates: { values: unknown; filters: [string, unknown][] }[] = [];
const inserts: Record<string, unknown>[] = [];
const commits = vi.fn();
vi.mock("@/lib/engine/commit", () => ({ commitPortfolioChange: (...a: unknown[]) => commits(...a) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      expect(table).toBe("design_probes");
      return {
        update: (values: unknown) => {
          const entry = { values, filters: [] as [string, unknown][] };
          updates.push(entry);
          const chain = {
            eq: (column: string, value: unknown) => {
              entry.filters.push([column, value]);
              return Object.assign(Promise.resolve({ error: null }), chain);
            },
          };
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "q-new" }, error: null }) }) };
        },
      };
    },
  }),
}));

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
const schema: PortfolioSchema = { fields: [field("name"), field("notes")], groups: [], version: 4 };
const section = (content: string) => ({ content, updatedAt: "2026-11-12T10:00:00Z" });
const intent = (purpose: string): StructuredIntent => ({
  purpose: section(purpose),
  audience: section(""),
  exclusions: section(""),
  constraints: section(""),
});

function hook() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useProposeIntentEdit("p1"), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  refine.mockReset();
  commits.mockReset();
  updates.length = 0;
  inserts.length = 0;
});

describe("useProposeIntentEdit (1E)", () => {
  it("stores the edit's changes as a question with a scoped preview, and writes no form", async () => {
    refine.mockResolvedValue({
      success: true,
      result: {
        schemaPatch: {
          addFields: [{ key: "school", label: "School", type: "string", required: true }],
          removeFieldKeys: ["notes"],
        },
        summary: "Adds the school, drops the notes",
      },
    });
    const { result } = hook();
    let proposal: Awaited<ReturnType<typeof result.current.mutateAsync>> = null;
    await act(async () => {
      proposal = await result.current.mutateAsync({
        previousIntent: intent("Sign-up"),
        intent: intent("Sign-up for pupils, with their school"),
        baseSchema: schema,
      });
    });

    expect(proposal).toEqual({ questionId: "q-new", changes: 2 });
    expect(commits).not.toHaveBeenCalled();

    // An earlier edit's open question is withdrawn first
    expect(updates).toEqual([
      {
        values: { status: "dismissed", closed_reason: "withdrawn" },
        filters: [
          ["portfolio_id", "p1"],
          ["source", INTENT_EDIT_SOURCE],
          ["status", "pending"],
        ],
      },
    ]);

    const [row] = inserts;
    expect(row).toMatchObject({
      portfolio_id: "p1",
      text: INTENT_EDIT_QUESTION,
      explanation: "Adds the school, drops the notes",
      source: INTENT_EDIT_SOURCE,
      status: "pending",
      selected_option: null,
      priority: 1,
      preview_status: "ready",
    });
    const options = row.options as { value: string; unchanged?: boolean; preview: { scope?: unknown } }[];
    expect(options).toHaveLength(2);
    expect(options.find((o) => o.value === "applyEdit")?.preview.scope).toEqual({
      added: ["school"],
      updated: [],
      removed: ["notes"],
    });
    expect(options.filter((o) => o.unchanged)).toHaveLength(1);
  });

  it("asks nothing when the edit changes nothing in the form", async () => {
    refine.mockResolvedValue({ success: true, result: { schemaPatch: {}, summary: "" } });
    const { result } = hook();
    let proposal: unknown = "unset";
    await act(async () => {
      proposal = await result.current.mutateAsync({
        previousIntent: intent("a"),
        intent: intent("b"),
        baseSchema: schema,
      });
    });
    expect(proposal).toBeNull();
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
