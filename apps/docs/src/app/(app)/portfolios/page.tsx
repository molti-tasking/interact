"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type PortfolioSummary,
  useDeletePortfolio,
  usePortfolioSummaries,
} from "@/hooks/query/portfolios";
import { useSpaces } from "@/hooks/query/spaces";
import { useNow } from "@/hooks/use-now";
import { buildLineageTree, type LineageTreeNode } from "@/lib/portfolio-tree";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/provenance-format";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CornerDownRight,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type SortKey = "updated" | "created" | "title";

const SORTS: Record<
  SortKey,
  { label: string; compare: (a: PortfolioSummary, b: PortfolioSummary) => number }
> = {
  updated: {
    label: "Recently updated",
    compare: (a, b) => b.updated_at.localeCompare(a.updated_at),
  },
  created: {
    label: "Recently created",
    compare: (a, b) => b.created_at.localeCompare(a.created_at),
  },
  title: {
    label: "Title (A–Z)",
    compare: (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  },
};

/** Indentation stops growing after this depth so cards stay readable. */
const MAX_INDENT_DEPTH = 3;

export default function PortfoliosPage() {
  const {
    data: allPortfolios,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = usePortfolioSummaries();
  const { data: spaces } = useSpaces();
  const deletePortfolio = useDeletePortfolio();
  const now = useNow();

  const [spaceFilter, setSpaceFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  // Target is kept after closing so the dialog text survives the exit animation.
  const [deleteTarget, setDeleteTarget] = useState<PortfolioSummary | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  const spaceNames = useMemo(
    () => new Map((spaces ?? []).map((s) => [s.id, s.name])),
    [spaces],
  );
  const byId = useMemo(
    () => new Map((allPortfolios ?? []).map((p) => [p.id, p])),
    [allPortfolios],
  );

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (allPortfolios ?? []).filter(
        (p) =>
          (!spaceFilter || p.space_id === spaceFilter) &&
          (!query ||
            p.title.toLowerCase().includes(query) ||
            p.purpose.toLowerCase().includes(query)),
      ),
    [allPortfolios, spaceFilter, query],
  );
  const tree = useMemo(
    () => buildLineageTree(filtered, SORTS[sort].compare),
    [filtered, sort],
  );

  const derivedCount = (id: string) =>
    (allPortfolios ?? []).filter((p) => p.base_id === id).length;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePortfolio.mutateAsync(deleteTarget.id);
      toast.success(`Deleted “${deleteTarget.title}”`);
    } catch (err) {
      toast.error("Couldn't delete the portfolio", {
        description:
          err instanceof Error ? err.message : "Please try again.",
      });
      throw err; // keep the dialog open
    }
  };

  const total = allPortfolios?.length ?? 0;
  const hasFilters = !!spaceFilter || !!query;
  const deleteBlockedBy = deleteTarget ? derivedCount(deleteTarget.id) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl tracking-tight text-primary">Portfolios</h1>
          <p className="text-sm text-muted-foreground">
            Intent portfolios: what each form is for, together with its
            schema and history.
          </p>
        </div>
        <Button asChild className="btn-brand">
          <Link href="/portfolios/new">
            <Plus className="h-4 w-4" aria-hidden />
            New portfolio
          </Link>
        </Button>
      </div>

      {total > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title or purpose…"
                aria-label="Search portfolios"
                className="bg-background pl-9"
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger
                className="w-full bg-background sm:w-48"
                aria-label="Sort portfolios"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORTS) as SortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORTS[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {spaces && spaces.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Filter by space"
            >
              <FilterChip
                active={spaceFilter === null}
                onClick={() => setSpaceFilter(null)}
              >
                All spaces
              </FilterChip>
              {spaces.map((space) => (
                <FilterChip
                  key={space.id}
                  active={spaceFilter === space.id}
                  onClick={() => setSpaceFilter(space.id)}
                >
                  <Folder className="mr-1 h-3 w-3" aria-hidden />
                  {space.name}
                </FilterChip>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="gap-3 p-5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card className="items-center gap-3 p-10 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
          <h2 className="text-lg">Couldn&apos;t load portfolios</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Please try again."}
          </p>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            {isRefetching ? "Retrying…" : "Retry"}
          </Button>
        </Card>
      ) : total === 0 ? (
        <Card className="items-center gap-3 p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground" aria-hidden />
          <h2 className="text-xl">No portfolios yet</h2>
          <p className="max-w-md text-muted-foreground">
            Describe what you want to collect in a sentence — the system drafts
            a form and helps you refine it.
          </p>
          <Button asChild className="btn-brand">
            <Link href="/portfolios/new">
              <Plus className="h-4 w-4" aria-hidden />
              Create your first portfolio
            </Link>
          </Button>
        </Card>
      ) : tree.length === 0 ? (
        <Card className="items-center gap-3 p-10 text-center">
          <Search className="h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="text-lg">No matching portfolios</h2>
          <p className="text-sm text-muted-foreground">
            Nothing matches your search or space filter.
          </p>
          {hasFilters && (
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setSpaceFilter(null);
              }}
            >
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <>
          {hasFilters && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {filtered.length} of {total}
            </p>
          )}
          <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tree.map((node) => (
              <LineageGroup
                key={node.item.id}
                node={node}
                renderCard={(n) => (
                  <PortfolioCard
                    portfolio={n.item}
                    isDerived={n.depth > 0}
                    orphanBase={
                      n.orphanedBaseId
                        ? (byId.get(n.orphanedBaseId) ?? {
                            id: n.orphanedBaseId,
                            title: "",
                          })
                        : null
                    }
                    spaceName={
                      n.item.space_id ? spaceNames.get(n.item.space_id) : undefined
                    }
                    now={now}
                    onDelete={() => {
                      setDeleteTarget(n.item);
                      setDeleteOpen(true);
                    }}
                  />
                )}
              />
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${deleteTarget?.title ?? ""}”?`}
        description={
          deleteBlockedBy > 0
            ? `${deleteBlockedBy} portfolio${deleteBlockedBy === 1 ? " is" : "s are"} derived from this one. Delete ${deleteBlockedBy === 1 ? "it" : "them"} first.`
            : "This permanently deletes the portfolio together with its responses, design probes and history. This can't be undone."
        }
        confirmLabel="Delete portfolio"
        pendingLabel="Deleting…"
        destructive
        confirmDisabled={deleteBlockedBy > 0}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function LineageGroup({
  node,
  renderCard,
}: {
  node: LineageTreeNode<PortfolioSummary>;
  renderCard: (node: LineageTreeNode<PortfolioSummary>) => React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {renderCard(node)}
      {node.children.length > 0 && (
        <ul
          className={cn(
            "flex flex-col gap-2",
            node.depth < MAX_INDENT_DEPTH && "pl-3",
          )}
          aria-label={`Derived from ${node.item.title}`}
        >
          {node.children.map((child) => (
            <li key={child.item.id} className="flex min-w-0 items-start gap-1.5">
              <CornerDownRight
                className="mt-5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <LineageGroup node={child} renderCard={renderCard} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
          : "text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const PROJECTION_LABELS: Record<string, string> = {
  sub: "subset",
  super: "superset",
  mixed: "mixed",
};

function PortfolioCard({
  portfolio,
  isDerived,
  orphanBase,
  spaceName,
  now,
  onDelete,
}: {
  portfolio: PortfolioSummary;
  isDerived: boolean;
  /** Base portfolio not shown in the current list (filtered out). */
  orphanBase: { id: string; title: string } | null;
  spaceName?: string;
  now: number;
  onDelete: () => void;
}) {
  const href = `/portfolios/${portfolio.id}`;
  const fieldCount = portfolio.fieldCount;

  return (
    <Card className="relative gap-2 p-4 card-hover-lift hover:border-primary/40 focus-within:border-primary/40">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-semibold leading-snug">
          {/* Stretched link: the whole card is clickable, the menu stays a
              separate control (no interactive content nested in the link). */}
          <Link
            href={href}
            prefetch={false}
            className="line-clamp-2 wrap-break-word after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {portfolio.title || "Untitled portfolio"}
          </Link>
        </h3>
        <Badge
          variant={portfolio.status === "published" ? "default" : "secondary"}
        >
          {portfolio.status}
        </Badge>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative z-10 -mr-2 -mt-1 h-7 w-7 text-muted-foreground"
              aria-label={`Actions for ${portfolio.title}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={href} prefetch={false}>
                <Pencil /> Open
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={`/forms/${portfolio.id}`}
                target="_blank"
                rel="noopener"
                prefetch={false}
              >
                <ExternalLink /> Open form
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${href}/derive`} prefetch={false}>
                <GitBranch /> Derive a view…
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {orphanBase && (
        <p className="relative z-10 flex w-fit items-center gap-1 text-xs text-muted-foreground">
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
          Derived from{" "}
          {orphanBase.title ? (
            <Link
              href={`/portfolios/${orphanBase.id}`}
              prefetch={false}
              className="truncate underline-offset-2 hover:underline"
            >
              {orphanBase.title}
            </Link>
          ) : (
            "another portfolio"
          )}
        </p>
      )}

      <p className="line-clamp-2 text-sm text-muted-foreground">
        {portfolio.purpose || "No intent described yet"}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" aria-hidden />
          {fieldCount} field{fieldCount !== 1 ? "s" : ""}
        </span>
        {spaceName && (
          <span className="flex min-w-0 items-center gap-1">
            <Folder className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{spaceName}</span>
          </span>
        )}
        {isDerived && portfolio.projectionType && (
          <Badge variant="outline" className="text-[10px]">
            {PROJECTION_LABELS[portfolio.projectionType] ??
              portfolio.projectionType}
          </Badge>
        )}
        <time
          dateTime={portfolio.updated_at}
          title={`Updated ${formatAbsoluteTime(portfolio.updated_at)}`}
          className="ml-auto"
        >
          {formatRelativeTime(portfolio.updated_at, now)}
        </time>
      </div>
    </Card>
  );
}
