// @vitest-environment node
/**
 * The `assistant` arm's prompt must stay neutral: the comparison with the
 * full tool is about who raises the open decisions, so the model must do
 * whatever it does by default.
 *
 * 1. No instruction to ask, not to ask, clarify, suggest, recommend, make
 *    assumptions or elicit — in the system prompt or in the descriptions of
 *    the output it returns (both are read by the model).
 * 2. No wording taken from the prompts of the full tool: no run of 8 words
 *    in a row that also occurs in a string of the engine or the server
 *    actions.
 * 3. The current form is in it on every turn.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assistantSystemPrompt,
  assistantTurnSchema,
  formAsJson,
} from "@/lib/study/prompts/assistant";
import type { PortfolioSchema } from "@/lib/types";

const EMPTY: PortfolioSchema = { version: 1, fields: [], groups: [] } as unknown as PortfolioSchema;

const FORM = {
  version: 1,
  fields: [
    {
      id: "f1",
      name: "childName",
      label: "Child's name",
      type: { kind: "text" },
      required: true,
      constraints: [],
      origin: "system",
      tags: [],
    },
    {
      id: "f2",
      name: "days",
      label: "Days attending",
      type: {
        kind: "select",
        multiple: true,
        options: [
          { label: "Monday", value: "mon" },
          { label: "Tuesday", value: "tue" },
        ],
      },
      required: false,
      constraints: [],
      origin: "creator",
      tags: [],
    },
  ],
  groups: [{ id: "g1", label: "The child", fieldIds: ["f1"] }],
} as unknown as PortfolioSchema;

/** Every description in the turn's output schema, as the model gets it. */
function outputDescriptions(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "description" && typeof value === "string") out.push(value);
      else walk(value);
    }
  };
  walk(z.toJSONSchema(assistantTurnSchema));
  return out;
}

/** Words that would steer the model towards (or away from) asking. */
const STEERING = [
  /\bask(s|ed|ing)?\b/i,
  /\bquestions?\b/i,
  /\bclarif/i,
  /\bsuggest/i,
  /\brecommend/i,
  /\bpropos/i,
  /\belicit/i,
  /\bprobe/i,
  /\bassum/i,
  /\binquir/i,
  /\bconfirm/i,
  /\bcheck with\b/i,
  /\bfollow[- ]?up/i,
  /\bproactive/i,
  /\banticipat/i,
  /\bunclear\b/i,
  /\bmissing\b/i,
  /\bconsider\b/i,
];

describe("assistant prompt: no steering", () => {
  const texts = {
    "system prompt": assistantSystemPrompt(FORM),
    "output schema": outputDescriptions().join("\n"),
  };

  for (const [what, text] of Object.entries(texts)) {
    it(`the ${what} has no instruction to ask or not to ask`, () => {
      const hits = STEERING.filter((pattern) => pattern.test(text)).map(String);
      expect(hits, text).toEqual([]);
    });
  }

  it("the check catches such instructions", () => {
    const bad = [
      "Ask clarifying questions before you build the form.",
      "Do not ask questions; just build it.",
      "Suggest fields the person may have missed.",
      "Make reasonable assumptions instead of checking with the user.",
    ];
    for (const sentence of bad) {
      expect(STEERING.some((pattern) => pattern.test(sentence)), sentence).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// No wording from the full tool's prompts
// ---------------------------------------------------------------------------

const PROMPT_SOURCES = [
  path.resolve(__dirname, "../../../../packages/interact/src/forms"),
  path.resolve(__dirname, "../../src/app/actions"),
];
const OWN = path.resolve(__dirname, "../../src/app/actions/assistant-actions.ts");
const SHINGLE = 8;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(entry.name) && full !== OWN ? [full] : [];
  });
}

/** The text of every string and template literal in a file. */
function literals(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

function shingles(text: string): string[] {
  const w = words(text);
  const out: string[] = [];
  for (let i = 0; i + SHINGLE <= w.length; i++) out.push(w.slice(i, i + SHINGLE).join(" "));
  return out;
}

describe("assistant prompt: written from scratch", () => {
  const theirs = new Set(
    PROMPT_SOURCES.flatMap(sourceFiles)
      .flatMap(literals)
      .flatMap(shingles),
  );

  it("reads the full tool's prompt sources", () => {
    expect(theirs.size).toBeGreaterThan(1000);
  });

  it("shares no run of 8 words with them", () => {
    // The shared patch vocabulary's own descriptions are the chat edits'
    // format, not prompt wording; the assistant's two are checked here
    const own = [
      assistantTurnSchema.shape.reply.description,
      assistantTurnSchema.shape.schemaPatch.description,
    ];
    expect(own.every(Boolean)).toBe(true);
    const ours = [assistantSystemPrompt(EMPTY), ...own.map(String)].flatMap(shingles);
    expect(ours.length).toBeGreaterThan(20);
    expect(ours.filter((s) => theirs.has(s))).toEqual([]);
  });

  it("the overlap check catches copied wording", () => {
    const copied = shingles("You are a form design assistant. Text inside tags below and in the request was written by the people designing or answering the form.");
    expect(copied.some((s) => theirs.has(s))).toBe(true);
  });
});

describe("assistant prompt: the current form on every turn", () => {
  it("lists every field with key, label, type, choices and section", () => {
    const prompt = assistantSystemPrompt(FORM);
    expect(prompt).toContain(formAsJson(FORM));
    const form = JSON.parse(formAsJson(FORM)) as { fields: Record<string, unknown>[] };
    expect(form.fields).toEqual([
      { key: "childName", label: "Child's name", type: "string", required: true, section: "The child" },
      { key: "days", label: "Days attending", type: "select", required: false, options: ["Monday", "Tuesday"], multiple: true },
    ]);
  });

  it("an empty form is an empty list", () => {
    expect(JSON.parse(formAsJson(EMPTY))).toEqual({ fields: [] });
  });
});
