"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useProvenance } from "@/hooks/query/provenance";
import { useResponses } from "@/hooks/query/responses-new";
import { useNow } from "@/hooks/use-now";
import {
  formatAbsoluteTime,
  formatActorLabel,
  formatProvenanceAction,
  formatRelativeTime,
  LAYER_META,
  parseActor,
} from "@/lib/provenance-format";
import type { ProvenanceLayer } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ClipboardList,
  FileText,
  FormInput,
  History,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

const LAYERS: ProvenanceLayer[] = ["intent", "dimensions", "configuration"];

const LAYER_COLORS: Record<ProvenanceLayer, { bar: string; chip: string }> = {
  intent: { bar: "bg-blue-500", chip: "text-blue-700 border-blue-200" },
  dimensions: { bar: "bg-violet-500", chip: "text-violet-700 border-violet-200" },
  configuration: { bar: "bg-amber-500", chip: "text-amber-700 border-amber-200" },
};

/** Distinct people shown individually; the rest are summed as "Others". */
const MAX_ACTORS = 6;

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const {
    data: portfolio,
    isLoading: loadingPortfolio,
    isError: portfolioError,
  } = usePortfolio(id);
  const {
    data: provenance,
    isLoading: loadingProvenance,
    isError: provenanceError,
    refetch: refetchProvenance,
  } = useProvenance(id);
  const { data: responses, isLoading: loadingResponses } = useResponses(id);
  const now = useNow();

  const stats = useMemo(() => {
    if (!provenance) return null;

    const byLayer: Record<ProvenanceLayer, number> = {
      intent: 0,
      dimensions: 0,
      configuration: 0,
    };
    // Actors are stored like "Alex (Coach)" or "system" — group per person.
    const byActor = new Map<
      string,
      { label: string; isSystem: boolean; count: number }
    >();
    const byDate = new Map<string, Record<ProvenanceLayer, number>>();

    for (const entry of provenance) {
      const layer = entry.layer;
      if (layer in byLayer) byLayer[layer]++;

      const actor = parseActor(entry.actor);
      const current = byActor.get(actor.key);
      if (current) current.count++;
      else
        byActor.set(actor.key, {
          label: actor.isSystem ? "System (AI)" : formatActorLabel(actor),
          isSystem: actor.isSystem,
          count: 1,
        });

      const date = entry.created_at
        ? new Date(entry.created_at).toISOString().slice(0, 10)
        : "unknown";
      if (!byDate.has(date))
        byDate.set(date, { intent: 0, dimensions: 0, configuration: 0 });
      const day = byDate.get(date)!;
      if (layer in day) day[layer]++;
    }

    const actorsSorted = Array.from(byActor.values()).sort(
      (a, b) => b.count - a.count,
    );
    const actors = actorsSorted.slice(0, MAX_ACTORS);
    const others = actorsSorted
      .slice(MAX_ACTORS)
      .reduce((n, a) => n + a.count, 0);
    if (others > 0) actors.push({ label: "Others", isSystem: false, count: others });

    const timeline = Array.from(byDate.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const maxPerDay = Math.max(
      1,
      ...timeline.map(([, d]) => d.intent + d.dimensions + d.configuration),
    );

    return {
      byLayer,
      actors,
      people: actorsSorted.filter((a) => !a.isSystem).length,
      timeline,
      maxPerDay,
    };
  }, [provenance]);

  if (loadingPortfolio) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="gap-2 p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-10" />
            </Card>
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (portfolioError || !portfolio) {
    // Not-found is handled by the portfolio layout; this is a fetch error.
    return (
      <Card className="items-center gap-3 p-10 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
        <h2 className="text-lg">Couldn&apos;t load the dashboard</h2>
      </Card>
    );
  }

  const total = provenance?.length ?? 0;

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Dashboard</h2>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <StatCard
          label="Fields"
          value={portfolio.schema?.fields?.length ?? 0}
          icon={<FileText className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Responses"
          value={loadingResponses ? "…" : (responses?.length ?? 0)}
          icon={<ClipboardList className="h-4 w-4" aria-hidden />}
          href={`/responses/${id}`}
        />
        <StatCard
          label="History entries"
          value={loadingProvenance ? "…" : total}
          icon={<History className="h-4 w-4" aria-hidden />}
          href={`/portfolios/${id}/provenance`}
        />
        <StatCard
          label="Status"
          value={portfolio.status ?? "draft"}
          icon={<FormInput className="h-4 w-4" aria-hidden />}
        />
      </div>

      {loadingProvenance ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : provenanceError ? (
        <Card className="items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the activity history.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetchProvenance()}>
            Retry
          </Button>
        </Card>
      ) : !stats || total === 0 ? (
        <Card className="items-center gap-2 p-10 text-center text-muted-foreground">
          <History className="h-10 w-10" aria-hidden />
          <p className="font-medium text-foreground">No activity yet</p>
          <p className="text-sm">
            Design decisions and edits will be charted here once the form
            starts taking shape.
          </p>
        </Card>
      ) : (
        <>
          {/* Activity over time */}
          <Card className="gap-4 p-4 sm:p-6">
            <h3 className="text-sm font-medium">Activity over time</h3>
            <div
              className="flex h-32 items-end gap-1"
              role="img"
              aria-label={`${total} history entries over ${stats.timeline.length} day${stats.timeline.length === 1 ? "" : "s"}`}
            >
              {stats.timeline.map(([date, counts]) => {
                const dayTotal =
                  counts.intent + counts.dimensions + counts.configuration;
                const heightPct = (dayTotal / stats.maxPerDay) * 100;
                return (
                  <div
                    key={date}
                    className="flex h-full min-w-0 max-w-12 flex-1 flex-col justify-end"
                    title={`${date}: ${dayTotal} entries`}
                  >
                    <div
                      className="flex w-full flex-col overflow-hidden rounded-t-sm"
                      style={{ height: `${heightPct}%` }}
                    >
                      {LAYERS.map((layer) =>
                        counts[layer] > 0 ? (
                          <div
                            key={layer}
                            className={LAYER_COLORS[layer].bar}
                            style={{ flexGrow: counts[layer] }}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{stats.timeline[0]?.[0]}</span>
              {stats.timeline.length > 1 && (
                <span>{stats.timeline.at(-1)?.[0]}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {LAYERS.map((layer) => (
                <span key={layer} className="flex items-center gap-1">
                  <span
                    className={cn("h-2 w-2 rounded-full", LAYER_COLORS[layer].bar)}
                    aria-hidden
                  />
                  {LAYER_META[layer].label}
                </span>
              ))}
            </div>
          </Card>

          {/* Breakdown */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="gap-3 p-4 sm:p-6">
              <h3 className="text-sm font-medium">By layer</h3>
              <div className="space-y-2">
                {LAYERS.map((layer) => (
                  <MeterRow
                    key={layer}
                    label={LAYER_META[layer].label}
                    count={stats.byLayer[layer]}
                    total={total}
                    color={LAYER_COLORS[layer].bar}
                  />
                ))}
              </div>
            </Card>

            <Card className="gap-3 p-4 sm:p-6">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">By contributor</h3>
                <span className="text-xs text-muted-foreground">
                  {stats.people} {stats.people === 1 ? "person" : "people"}
                </span>
              </div>
              <div className="space-y-2">
                {stats.actors.map((actor) => (
                  <MeterRow
                    key={actor.label}
                    label={actor.label}
                    count={actor.count}
                    total={total}
                    color={actor.isSystem ? "bg-muted-foreground" : "bg-primary"}
                  />
                ))}
              </div>
            </Card>
          </div>

          {/* Recent actions */}
          <Card className="gap-3 p-4 sm:p-6">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Recent actions</h3>
              <Link
                href={`/portfolios/${id}/provenance`}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Full history
              </Link>
            </div>
            <ul className="divide-y">
              {provenance!.slice(0, 5).map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("font-normal", LAYER_COLORS[entry.layer]?.chip)}
                    >
                      {LAYER_META[entry.layer]?.label ?? entry.layer}
                    </Badge>
                    <span className="truncate">
                      {formatProvenanceAction(entry.action)}
                    </span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                      · {parseActor(entry.actor).name}
                    </span>
                  </div>
                  <time
                    dateTime={entry.created_at}
                    title={formatAbsoluteTime(entry.created_at)}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {formatRelativeTime(entry.created_at, now)}
                  </time>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-semibold capitalize tabular-nums">{value}</p>
    </>
  );
  return (
    <Card
      className={cn(
        "relative gap-1 p-4",
        href && "card-hover-lift hover:border-primary/40",
      )}
    >
      {href ? (
        <Link
          href={href}
          className="flex flex-col gap-1 after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </Card>
  );
}

function MeterRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 truncate text-xs text-muted-foreground sm:w-40" title={label}>
        {label}
      </span>
      <div
        className="h-3 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={count}
      >
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-medium tabular-nums">{count}</span>
    </div>
  );
}
