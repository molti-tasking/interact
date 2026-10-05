import { describe, expect, it } from "vitest";
import {
  buildLineageTree,
  countDescendants,
  flattenLineageTree,
} from "@/lib/portfolio-tree";

type P = { id: string; base_id: string | null; title?: string };

const p = (id: string, base_id: string | null = null, title = id): P => ({
  id,
  base_id,
  title,
});

const ids = (nodes: { item: P }[]) => nodes.map((n) => n.item.id);

describe("buildLineageTree", () => {
  it("nests children of arbitrary depth (derived-of-derived)", () => {
    const tree = buildLineageTree([p("root"), p("child", "root"), p("grand", "child")]);
    expect(ids(tree)).toEqual(["root"]);
    expect(ids(tree[0].children)).toEqual(["child"]);
    expect(ids(tree[0].children[0].children)).toEqual(["grand"]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it("keeps every item even when the input lists children first", () => {
    const tree = buildLineageTree([p("grand", "child"), p("child", "root"), p("root")]);
    expect(flattenLineageTree(tree)).toHaveLength(3);
    expect(ids(flattenLineageTree(tree))).toEqual(["root", "child", "grand"]);
  });

  it("promotes a portfolio whose base is not in the list to a root with a hint", () => {
    // e.g. the base lives in another space and was filtered out
    const tree = buildLineageTree([p("child", "missing-base"), p("grand", "child")]);
    expect(ids(tree)).toEqual(["child"]);
    expect(tree[0].orphanedBaseId).toBe("missing-base");
    expect(tree[0].depth).toBe(0);
    expect(ids(tree[0].children)).toEqual(["grand"]);
    expect(tree[0].children[0].orphanedBaseId).toBeNull();
  });

  it("roots without a base have no orphan hint", () => {
    expect(buildLineageTree([p("a")])[0].orphanedBaseId).toBeNull();
  });

  it("does not lose items on self-references or cycles", () => {
    const tree = buildLineageTree([p("self", "self"), p("a", "b"), p("b", "a")]);
    const flat = flattenLineageTree(tree);
    expect(flat.map((n) => n.item.id).sort()).toEqual(["a", "b", "self"]);
    expect(new Set(flat.map((n) => n.item.id)).size).toBe(3);
    expect(tree.find((n) => n.item.id === "self")?.orphanedBaseId).toBeNull();
  });

  it("preserves input order among siblings by default", () => {
    const tree = buildLineageTree([p("r"), p("c2", "r"), p("c1", "r")]);
    expect(ids(tree[0].children)).toEqual(["c2", "c1"]);
  });

  it("sorts siblings at every level with a compare function", () => {
    const tree = buildLineageTree(
      [p("r2"), p("r1"), p("c2", "r1"), p("c1", "r1")],
      (a, b) => a.id.localeCompare(b.id),
    );
    expect(ids(tree)).toEqual(["r1", "r2"]);
    expect(ids(tree[0].children)).toEqual(["c1", "c2"]);
  });
});

describe("countDescendants", () => {
  it("counts transitive children", () => {
    const [root] = buildLineageTree([
      p("root"),
      p("a", "root"),
      p("b", "root"),
      p("a1", "a"),
    ]);
    expect(countDescendants(root)).toBe(3);
    expect(countDescendants(root.children[1])).toBe(0);
  });
});
