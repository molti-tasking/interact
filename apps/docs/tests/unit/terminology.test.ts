// @vitest-environment node
/**
 * The paper's term is "elicitation question". Nothing a user or participant
 * can read says "probe" anymore; identifiers the analysis scripts read
 * (tables, columns, log event names, the `no-probes` condition key) keep
 * their names.
 *
 * Checked on the source: every piece of prose in the app — JSX text and
 * string or template literals that contain a space — must be free of the
 * word, wherever it ends up (labels, toasts, error messages, prompts whose
 * wording a model might repeat). Identifier-like strings ("probe_answered",
 * "no-probes", "design-probes") are not prose.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOTS = [
  path.resolve(__dirname, "../../src"),
  path.resolve(__dirname, "../../../../packages/interact/src"),
];
const WORD = /\bprobes?\b/i;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx?$/.test(entry.name) && !/database\.types\.ts$/.test(entry.name) ? [full] : [];
  });
}

/** Developer-facing output: never shown in the interface. */
function isDeveloperOutput(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = n.expression.expression;
      if (ts.isIdentifier(target) && target.text === "console") return true;
    }
    if (ts.isJsxAttribute(n) && /^data-/.test(n.name.getText())) return true;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
  }
  return false;
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function proseWithWord(file: string): Hit[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isJsxText(node)) text = node.text;
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      text = (node as ts.LiteralLikeNode).text;
    }
    if (text !== null && WORD.test(text)) {
      const prose = ts.isJsxText(node) || /\s/.test(text.trim());
      if (prose && !isDeveloperOutput(node)) {
        hits.push({
          file: path.relative(path.resolve(__dirname, "../../../.."), file),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text: text.trim().replace(/\s+/g, " ").slice(0, 100),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("terminology", () => {
  const all = ROOTS.flatMap(files);

  it("scans the app and the engine", () => {
    expect(all.length).toBeGreaterThan(150);
    // The check sees prose: a known label is found as such
    const deck = all.find((f) => f.endsWith("DesignProbeDeck.tsx"))!;
    expect(fs.readFileSync(deck, "utf-8")).toContain("Elicitation questions");
  });

  it('has no "probe" in anything a user can read', () => {
    const hits = all.flatMap(proseWithWord);
    expect(hits.map((h) => `${h.file}:${h.line}  ${h.text}`)).toEqual([]);
  });

  it("keeps the identifiers the analysis scripts read", () => {
    const text = (rel: string) =>
      fs.readFileSync(path.resolve(__dirname, "../../src", rel), "utf-8");
    const deck = text("components/workspace/DesignProbeDeck.tsx");
    for (const event of ["probe_shown", "probe_answered", "probe_expanded", "probe_dismissed"]) {
      expect(deck, event).toContain(`"${event}"`);
    }
    expect(text("lib/study/types.ts")).toContain('"no-probes"');
    expect(text("lib/study/coding.ts")).toContain('"probes_answered"');
    expect(text("hooks/query/design-probes.ts")).toContain('.from("design_probes")');
  });
});
