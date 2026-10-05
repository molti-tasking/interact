/**
 * Derivation lineage as a tree (Design Principle 4: scenario-driven
 * derivation). Portfolios point at their base via `base_id`; derived
 * portfolios can themselves be derived from, so the tree has arbitrary depth.
 *
 * Works on any subset of portfolios (space filter, search): a portfolio whose
 * base is not part of the given list becomes a root and remembers the missing
 * base id in `orphanedBaseId` so the UI can show a "derived from …" hint.
 */

export interface LineageItem {
  id: string;
  base_id: string | null;
}

export interface LineageTreeNode<T extends LineageItem> {
  item: T;
  depth: number;
  children: LineageTreeNode<T>[];
  /** `base_id` of a root whose base is not in the list (else null). */
  orphanedBaseId: string | null;
}

/**
 * Build a lineage forest. Input order is preserved among siblings unless a
 * `compare` function is given. Every input item appears exactly once — even
 * with corrupt data (self-references, cycles).
 */
export function buildLineageTree<T extends LineageItem>(
  items: readonly T[],
  compare?: (a: T, b: T) => number,
): LineageTreeNode<T>[] {
  const ids = new Set(items.map((p) => p.id));
  const parentOf = (p: T): string | null =>
    p.base_id && p.base_id !== p.id && ids.has(p.base_id) ? p.base_id : null;

  const childrenByParent = new Map<string, T[]>();
  const roots: T[] = [];
  for (const p of items) {
    const parent = parentOf(p);
    if (parent) {
      const siblings = childrenByParent.get(parent) ?? [];
      siblings.push(p);
      childrenByParent.set(parent, siblings);
    } else {
      roots.push(p);
    }
  }

  const sorted = (list: T[]) => (compare ? [...list].sort(compare) : list);
  const visited = new Set<string>();

  const build = (
    item: T,
    depth: number,
    orphanedBaseId: string | null,
  ): LineageTreeNode<T> => {
    visited.add(item.id);
    const children = sorted(childrenByParent.get(item.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .map((child) => build(child, depth + 1, null));
    return { item, depth, children, orphanedBaseId };
  };

  const forest = sorted(roots).map((root) =>
    build(
      root,
      0,
      root.base_id && root.base_id !== root.id ? root.base_id : null,
    ),
  );

  // Cycles (a → b → a) have no root; break them so nothing disappears.
  for (const p of items) {
    if (!visited.has(p.id)) forest.push(build(p, 0, p.base_id));
  }

  return forest;
}

/** Depth-first flattening (parents before their children). */
export function flattenLineageTree<T extends LineageItem>(
  nodes: readonly LineageTreeNode<T>[],
): LineageTreeNode<T>[] {
  const out: LineageTreeNode<T>[] = [];
  const walk = (list: readonly LineageTreeNode<T>[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Number of portfolios derived (directly or transitively) from `node`. */
export function countDescendants<T extends LineageItem>(
  node: LineageTreeNode<T>,
): number {
  return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}
