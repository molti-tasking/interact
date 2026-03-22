"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useProvenance } from "@/hooks/query/provenance";
import { useResponses } from "@/hooks/query/responses-new";
import type { PortfolioSchema } from "@/lib/types";
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  FormInput,
  History,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading: loadingPortfolio } = usePortfolio(id);
  const { data: provenance } = useProvenance(id);
  const { data: responses } = useResponses(id);

  const schema = portfolio?.schema as unknown as PortfolioSchema | undefined;

  const stats = useMemo(() => {
    if (!provenance) return null;

    const byLayer = { intent: 0, dimensions: 0, configuration: 0 };
    const byActor = { creator: 0, system: 0 };
    const byDate = new Map<
      string,
      { intent: number; dimensions: number; configuration: number }
    >();

    for (const entry of provenance) {
      const layer = entry.layer as keyof typeof byLayer;
      if (layer in byLayer) byLayer[layer]++;

      const actor = entry.actor as keyof typeof byActor;
      if (actor in byActor) byActor[actor]++;

      const date = entry.created_at
        ? new Date(entry.created_at).toISOString().slice(0, 10)
        : "unknown";
      if (!byDate.has(date))
        byDate.set(date, { intent: 0, dimensions: 0, configuration: 0 });
      const day = byDate.get(date)!;
      if (layer in day) day[layer]++;
    }

    // Sort dates ascending
    const timeline = Array.from(byDate.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    const maxPerDay = Math.max(
      1,
      ...timeline.map(([, d]) => d.intent + d.dimensions + d.configuration),
    );

    return { byLayer, byActor, timeline, maxPerDay };
  }, [provenance]);

  if (loadingPortfolio) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-12">
        <h2 className="text-lg font-semibold">Portfolio not found</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/portfolios/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {portfolio.title}
          </h1>
          <p className="text-sm text-muted-foreground">Dashboard</p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Fields"
          value={schema?.fields.length ?? 0}
          icon={<FileText className="h-4 w-4" />}
        />
        <StatCard
          label="Responses"
          value={responses?.length ?? 0}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <StatCard
          label="History Entries"
          value={provenance?.length ?? 0}
          icon={<History className="h-4 w-4" />}
        />
        <StatCard
          label="Status"
          value={portfolio.status ?? "draft"}
          icon={<FormInput className="h-4 w-4" />}
        />
      </div>

      {/* Quick links */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/forms/${id}`}>
            <FormInput className="h-4 w-4 mr-1" />
            Fill Form
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/responses/${id}`}>
            <ClipboardList className="h-4 w-4 mr-1" />
            View Responses
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/portfolios/${id}/provenance`}>
            <History className="h-4 w-4 mr-1" />
            Full History
          </Link>
        </Button>
      </div>

      {/* Provenance timeline chart */}
      {stats && stats.timeline.length > 0 && (
        <Card className="p-6">
          <h3 className="text-sm font-medium mb-4">Activity Over Time</h3>
          <div className="flex items-end gap-1 h-32">
            {stats.timeline.map(([date, counts]) => {
              const total =
                counts.intent + counts.dimensions + counts.configuration;
              const heightPct = (total / stats.maxPerDay) * 100;
              const intentPct = total > 0 ? (counts.intent / total) * 100 : 0;
              const dimPct = total > 0 ? (counts.dimensions / total) * 100 : 0;

              return (
                <div
                  key={date}
                  className="flex-1 flex flex-col justify-end group relative"
                  title={`${date}: ${total} entries`}
                >
                  <div
                    className="w-full rounded-t-sm overflow-hidden flex flex-col"
                    style={{ height: `${heightPct}%` }}
                  >
                    <div
                      className="bg-blue-500"
                      style={{ height: `${intentPct}%` }}
                    />
                    <div
                      className="bg-violet-500"
                      style={{ height: `${dimPct}%` }}
                    />
                    <div className="bg-amber-500 flex-1" />
                  </div>
                  <span className="text-[8px] text-muted-foreground text-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-4 left-0 right-0">
                    {date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> Intent
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-violet-500" /> Dimensions
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />{" "}
              Configuration
            </span>
          </div>
        </Card>
      )}

      {/* Layer breakdown */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-6">
            <h3 className="text-sm font-medium mb-3">By Layer</h3>
            <div className="space-y-2">
              <LayerBar
                label="Intent"
                count={stats.byLayer.intent}
                total={provenance?.length ?? 1}
                color="bg-blue-500"
              />
              <LayerBar
                label="Dimensions"
                count={stats.byLayer.dimensions}
                total={provenance?.length ?? 1}
                color="bg-violet-500"
              />
              <LayerBar
                label="Configuration"
                count={stats.byLayer.configuration}
                total={provenance?.length ?? 1}
                color="bg-amber-500"
              />
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-sm font-medium mb-3">By Actor</h3>
            <div className="space-y-2">
              <LayerBar
                label="Creator"
                count={stats.byActor.creator}
                total={provenance?.length ?? 1}
                color="bg-foreground"
              />
              <LayerBar
                label="System"
                count={stats.byActor.system}
                total={provenance?.length ?? 1}
                color="bg-muted-foreground"
              />
            </div>
          </Card>
        </div>
      )}

      {/* Recent actions */}
      {provenance && provenance.length > 0 && (
        <Card className="p-6">
          <h3 className="text-sm font-medium mb-3">Recent Actions</h3>
          <div className="space-y-2">
            {provenance.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      entry.layer === "intent"
                        ? "text-blue-600 border-blue-200"
                        : entry.layer === "dimensions"
                          ? "text-violet-600 border-violet-200"
                          : "text-amber-600 border-amber-200"
                    }
                  >
                    {entry.layer}
                  </Badge>
                  <span className="text-muted-foreground">{entry.action}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {entry.created_at
                    ? new Date(entry.created_at).toLocaleString()
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </Card>
  );
}

function LayerBar({
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
  const pct = Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-24">{label}</span>
      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium w-8 text-right">{count}</span>
    </div>
  );
}
