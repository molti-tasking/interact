"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/context/user-context";
import { applyCommitToCache, usePortfolio } from "@/hooks/query/portfolios";
import {
  type ProvenanceListEntry,
  useProvenancePages,
  useProvenanceSnapshot,
} from "@/hooks/query/provenance";
import { useNow } from "@/hooks/use-now";
import { restoreSnapshot } from "@/lib/engine/commit";
import { formatActor } from "@/lib/mock-users";
import {
  describeFieldChanges,
  fieldDisplayName,
  formatAbsoluteTime,
  formatActorLabel,
  formatFieldType,
  formatProvenanceAction,
  formatRelativeTime,
  groupByDay,
  LAYER_META,
  parseActor,
  summarizeDiff,
} from "@/lib/provenance-format";
import type {
  Field,
  ProvenanceLayer,
  SectionKey,
  StructuredIntent,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronDown,
  History,
  Loader2,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

const LAYERS: ProvenanceLayer[] = ["intent", "dimensions", "configuration"];

const LAYER_STYLES: Record<ProvenanceLayer, { chip: string; dot: string }> = {
  intent: { chip: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  dimensions: {
    chip: "border-violet-200 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
  configuration: {
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
};

const INTENT_SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "purpose", label: "Purpose" },
  { key: "audience", label: "Audience" },
  { key: "exclusions", label: "Exclusions" },
  { key: "constraints", label: "Constraints" },
];

const MAX_FIELDS_COLLAPSED = 12;

export default function ProvenancePage() {
  const { id } = useParams<{ id: string }>();
  const timeline = useProvenancePages(id);
  const now = useNow();

  const [layerFilter, setLayerFilter] = useState<ProvenanceLayer | "all">("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [restoreTarget, setRestoreTarget] = useState<ProvenanceListEntry | null>(
    null,
  );
  const [restoreOpen, setRestoreOpen] = useState(false);

  const entries = useMemo(
    () => timeline.data?.pages.flat() ?? [],
    [timeline.data],
  );

  // Entry → the entry recorded right after it (its "after" state).
  const newerEntryId = useMemo(() => {
    const map = new Map<string, string | null>();
    entries.forEach((e, i) => map.set(e.id, i > 0 ? entries[i - 1].id : null));
    return map;
  }, [entries]);

  const actors = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const e of entries) {
      const actor = parseActor(e.actor);
      const current = counts.get(actor.key);
      if (current) current.count++;
      else counts.set(actor.key, { label: formatActorLabel(actor), count: 1 });
    }
    return Array.from(counts, ([key, v]) => ({ key, ...v })).sort(
      (a, b) => b.count - a.count,
    );
  }, [entries]);

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.layer] = (counts[e.layer] ?? 0) + 1;
    return counts;
  }, [entries]);

  const filtered = entries.filter(
    (e) =>
      (layerFilter === "all" || e.layer === layerFilter) &&
      (actorFilter === "all" || parseActor(e.actor).key === actorFilter),
  );
  const groups = groupByDay(filtered, now);
  const hasFilters = layerFilter !== "all" || actorFilter !== "all";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl tracking-tight">Provenance Timeline</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every change to the intent and the schema — who made it, when and
          why. Expand an entry to see what changed, or restore the form to how
          it was before that change.
        </p>
      </div>

      {timeline.isLoading ? (
        <TimelineSkeleton />
      ) : timeline.isError ? (
        <Card className="items-center gap-3 p-10 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
          <h3 className="text-lg font-medium">Couldn&apos;t load the history</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            {timeline.error instanceof Error
              ? timeline.error.message
              : "Please try again."}
          </p>
          <Button
            variant="outline"
            onClick={() => timeline.refetch()}
            disabled={timeline.isRefetching}
          >
            {timeline.isRefetching ? "Retrying…" : "Retry"}
          </Button>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="items-center gap-2 p-10 text-center text-muted-foreground">
          <History className="h-10 w-10" aria-hidden />
          <p className="font-medium text-foreground">No history yet</p>
          <p className="text-sm">
            Changes will appear here as you design the form.
          </p>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Filter by layer"
            >
              <FilterChip
                active={layerFilter === "all"}
                onClick={() => setLayerFilter("all")}
              >
                All layers
                <span className="tabular-nums opacity-60">{entries.length}</span>
              </FilterChip>
              {LAYERS.map((layer) => (
                <FilterChip
                  key={layer}
                  active={layerFilter === layer}
                  onClick={() => setLayerFilter(layer)}
                  title={LAYER_META[layer].description}
                >
                  <span
                    className={cn("h-2 w-2 rounded-full", LAYER_STYLES[layer].dot)}
                    aria-hidden
                  />
                  {LAYER_META[layer].label}
                  <span className="tabular-nums opacity-60">
                    {layerCounts[layer] ?? 0}
                  </span>
                </FilterChip>
              ))}
            </div>
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger
                className="w-full bg-background sm:w-60"
                aria-label="Filter by person"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {actors.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.label} · {a.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasFilters && groups.length > 0 && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {filtered.length} of {entries.length} loaded entries ·{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  setLayerFilter("all");
                  setActorFilter("all");
                }}
              >
                Clear filters
              </button>
            </p>
          )}

          {groups.length === 0 ? (
            <Card className="items-center gap-3 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No entries match these filters
                {timeline.hasNextPage ? " in the loaded history" : ""}.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLayerFilter("all");
                  setActorFilter("all");
                }}
              >
                Clear filters
              </Button>
            </Card>
          ) : (
            <div className="space-y-8">
              {groups.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <h3 className="mb-3 text-sm font-medium text-muted-foreground">
                    {group.label}
                  </h3>
                  <ol className="ml-2 space-y-3 border-l border-border pl-5">
                    {group.entries.map((entry) => (
                      <li key={entry.id} className="relative">
                        <span
                          aria-hidden
                          className={cn(
                            "absolute -left-5 top-5 h-3 w-3 -translate-x-1/2 rounded-full ring-4 ring-background",
                            LAYER_STYLES[entry.layer]?.dot ?? "bg-muted-foreground",
                          )}
                        />
                        <EntryCard
                          entry={entry}
                          portfolioId={id}
                          newerEntryId={newerEntryId.get(entry.id) ?? null}
                          now={now}
                          onRestore={() => {
                            setRestoreTarget(entry);
                            setRestoreOpen(true);
                          }}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}

          {timeline.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => timeline.fetchNextPage()}
                disabled={timeline.isFetchingNextPage}
              >
                {timeline.isFetchingNextPage && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Load older entries
              </Button>
            </div>
          )}
        </>
      )}

      {restoreTarget && (
        <RestoreDialog
          portfolioId={id}
          entry={restoreTarget}
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function EntryCard({
  entry,
  portfolioId,
  newerEntryId,
  now,
  onRestore,
}: {
  entry: ProvenanceListEntry;
  portfolioId: string;
  newerEntryId: string | null;
  now: number;
  onRestore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const actor = parseActor(entry.actor);
  const diff = summarizeDiff(entry.diff);
  const layerStyle = LAYER_STYLES[entry.layer];

  return (
    <Card data-testid="provenance-entry" className="gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="font-medium leading-snug" title={entry.action}>
            {formatProvenanceAction(entry.action)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="max-w-full gap-1 font-normal"
              title={entry.actor}
            >
              {actor.isSystem ? (
                <Bot aria-hidden />
              ) : (
                <UserRound aria-hidden />
              )}
              <span className="truncate">
                {actor.name}
                {actor.role && (
                  <span className="text-muted-foreground"> · {actor.role}</span>
                )}
              </span>
            </Badge>
            <Badge
              variant="outline"
              className={cn("font-normal", layerStyle?.chip)}
              title={LAYER_META[entry.layer]?.description}
            >
              {LAYER_META[entry.layer]?.label ?? entry.layer}
            </Badge>
          </div>
        </div>
        <time
          dateTime={entry.created_at}
          title={formatAbsoluteTime(entry.created_at)}
          className="shrink-0 pt-0.5 text-xs text-muted-foreground"
        >
          {formatRelativeTime(entry.created_at, now)}
        </time>
      </div>

      {entry.rationale && (
        <p
          className={cn(
            "whitespace-pre-line text-sm text-muted-foreground",
            !expanded && "line-clamp-3",
          )}
        >
          {entry.rationale}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {diff.added > 0 && (
          <Badge variant="outline" className="border-green-200 font-normal text-green-700">
            +{diff.added} added
          </Badge>
        )}
        {diff.removed > 0 && (
          <Badge variant="outline" className="border-red-200 font-normal text-red-700">
            −{diff.removed} removed
          </Badge>
        )}
        {diff.modified > 0 && (
          <Badge variant="outline" className="border-amber-200 font-normal text-amber-700">
            ~{diff.modified} modified
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs text-muted-foreground"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide details" : "Details"}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </Button>
      </div>

      {expanded && (
        <div id={detailsId} className="space-y-4 border-t pt-3">
          <EntryDetails
            entry={entry}
            portfolioId={portfolioId}
            newerEntryId={newerEntryId}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {formatAbsoluteTime(entry.created_at)} ·{" "}
              <code className="font-mono">{entry.action}</code>
            </span>
            <Button variant="outline" size="sm" onClick={onRestore}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Restore state before this change
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function collectFields(fields: Field[] | undefined, into = new Map<string, Field>()) {
  for (const f of fields ?? []) {
    into.set(f.id, f);
    if (f.type?.kind === "group") collectFields(f.type.fields, into);
  }
  return into;
}

function EntryDetails({
  entry,
  portfolioId,
  newerEntryId,
}: {
  entry: ProvenanceListEntry;
  portfolioId: string;
  newerEntryId: string | null;
}) {
  const { added, removed, modified } = entry.diff;
  const isIntent = entry.layer === "intent";
  const needsSnapshot = removed.length > 0 || isIntent;
  const snapshot = useProvenanceSnapshot(needsSnapshot ? entry.id : null);

  const previousFields = useMemo(
    () => collectFields(snapshot.data?.prev_schema?.fields),
    [snapshot.data],
  );

  const nothing =
    added.length === 0 && removed.length === 0 && modified.length === 0;

  return (
    <div className="space-y-4 text-sm">
      {added.length > 0 && (
        <DetailSection title="Added fields" tone="text-green-700">
          <FieldList
            items={added.map((f, i) => ({
              key: f.id ?? `${f.name}-${i}`,
              name: fieldDisplayName(f),
              meta: [formatFieldType(f.type), f.required ? "required" : ""]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        </DetailSection>
      )}

      {removed.length > 0 && (
        <DetailSection title="Removed fields" tone="text-red-700">
          {snapshot.isLoading ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <FieldList
              items={removed.map((fieldId) => {
                const field = previousFields.get(fieldId);
                return {
                  key: fieldId,
                  name: field ? fieldDisplayName(field) : fieldId,
                  meta: field ? formatFieldType(field.type) : "",
                  strike: true,
                };
              })}
            />
          )}
        </DetailSection>
      )}

      {modified.length > 0 && (
        <DetailSection title="Modified fields" tone="text-amber-700">
          <ul className="space-y-3">
            {modified.map((patch) => {
              const changes = describeFieldChanges(patch.before, patch.after);
              return (
                <li key={patch.fieldId}>
                  <p className="font-medium">
                    {fieldDisplayName(
                      patch.after?.label || patch.after?.name
                        ? patch.after
                        : patch.before,
                    )}
                  </p>
                  {changes.length > 0 && (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {changes.map((c) => (
                        <div key={c.property} className="contents">
                          <dt className="text-muted-foreground">{c.property}</dt>
                          <dd className="flex min-w-0 flex-wrap items-center gap-1">
                            <span className="break-all text-muted-foreground line-through decoration-red-400/70">
                              {c.before}
                            </span>
                            <ArrowRight
                              className="h-3 w-3 shrink-0 text-muted-foreground"
                              aria-label="changed to"
                            />
                            <span className="break-all">{c.after}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        </DetailSection>
      )}

      {isIntent && (
        <IntentChange
          before={snapshot.data?.prev_intent ?? null}
          loadingBefore={snapshot.isLoading}
          portfolioId={portfolioId}
          newerEntryId={newerEntryId}
        />
      )}

      {nothing && !isIntent && (
        <p className="text-muted-foreground">
          No field-level changes were recorded for this entry.
        </p>
      )}
    </div>
  );
}

/**
 * Intent before/after this entry. "After" is the state the next entry
 * started from — or the current intent for the newest entry.
 */
function IntentChange({
  before,
  loadingBefore,
  portfolioId,
  newerEntryId,
}: {
  before: StructuredIntent | null;
  loadingBefore: boolean;
  portfolioId: string;
  newerEntryId: string | null;
}) {
  const newer = useProvenanceSnapshot(newerEntryId);
  const { data: portfolio } = usePortfolio(newerEntryId ? undefined : portfolioId);
  const after = newerEntryId ? (newer.data?.prev_intent ?? null) : (portfolio?.intent ?? null);
  const loading = loadingBefore || (newerEntryId ? newer.isLoading : !portfolio);

  if (loading) return <Skeleton className="h-12 w-full" />;
  if (!before && !after) return null;

  const changed = INTENT_SECTIONS.filter(
    ({ key }) =>
      (before?.[key]?.content ?? "").trim() !== (after?.[key]?.content ?? "").trim(),
  );

  return (
    <DetailSection title="Intent changes" tone="text-blue-700">
      {changed.length === 0 ? (
        <p className="text-muted-foreground">The intent text did not change.</p>
      ) : (
        <div className="space-y-3">
          {changed.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <IntentText label="Before" text={before?.[key]?.content} muted />
                <IntentText label="After" text={after?.[key]?.content} />
              </div>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

function IntentText({
  label,
  text,
  muted,
}: {
  label: string;
  text: string | undefined;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-2 text-xs",
        muted ? "bg-muted/40 text-muted-foreground" : "bg-background",
      )}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="line-clamp-6 whitespace-pre-line wrap-break-word">
        {text?.trim() || <em>empty</em>}
      </p>
    </div>
  );
}

function DetailSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className={cn("text-xs font-medium uppercase tracking-wide", tone)}>
        {title}
      </p>
      {children}
    </div>
  );
}

function FieldList({
  items,
}: {
  items: { key: string; name: string; meta: string; strike?: boolean }[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, MAX_FIELDS_COLLAPSED);
  return (
    <>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {visible.map((item) => (
          <li key={item.key} className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "truncate",
                item.strike && "line-through decoration-red-400/70",
              )}
            >
              {item.name}
            </span>
            {item.meta && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.meta}
              </span>
            )}
          </li>
        ))}
      </ul>
      {items.length > MAX_FIELDS_COLLAPSED && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

function RestoreDialog({
  portfolioId,
  entry,
  open,
  onOpenChange,
}: {
  portfolioId: string;
  entry: ProvenanceListEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const snapshot = useProvenanceSnapshot(open ? entry.id : null);

  const label = formatProvenanceAction(entry.action);
  const when = formatAbsoluteTime(entry.created_at);
  const hasSnapshot =
    !!snapshot.data && (!!snapshot.data.prev_schema || !!snapshot.data.prev_intent);

  const handleRestore = async () => {
    if (!snapshot.data || !hasSnapshot) return;
    try {
      const result = await restoreSnapshot(
        portfolioId,
        {
          schema: snapshot.data.prev_schema,
          intent: snapshot.data.prev_intent,
        },
        formatActor(currentUser),
        `Restored the state before “${label}” (${when}).`,
      );
      applyCommitToCache(queryClient, result);
      toast.success("Earlier version restored", {
        description: "The restore is recorded in the history and can be reverted the same way.",
      });
    } catch (err) {
      toast.error("Couldn't restore this version", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
      throw err;
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Restore the state before this change?"
      description={
        <>
          The form&apos;s fields and intent go back to how they were right
          before <strong>{label}</strong> ({when}). Later entries stay in the
          history and responses are kept; the restore itself is logged as a new
          entry.
        </>
      }
      confirmLabel="Restore"
      pendingLabel="Restoring…"
      confirmDisabled={!hasSnapshot}
      onConfirm={handleRestore}
    >
      {snapshot.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading the earlier version…
        </p>
      ) : snapshot.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the earlier version.
        </p>
      ) : !hasSnapshot ? (
        <p className="text-sm text-muted-foreground">
          No snapshot was recorded for this entry, so it can&apos;t be restored.
        </p>
      ) : snapshot.data?.prev_schema ? (
        <p className="text-sm text-muted-foreground">
          That version has {snapshot.data.prev_schema.fields.length} field
          {snapshot.data.prev_schema.fields.length === 1 ? "" : "s"}.
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
          : "bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TimelineSkeleton() {
  return (
    // Deliberately not `.space-y-3 .p-4`: the paper screenshot script waits
    // for that selector to detect loaded entries.
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading history">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="gap-2 px-4 py-4">
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </Card>
      ))}
    </div>
  );
}
