"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreatePortfolio, usePortfolios } from "@/hooks/query/portfolios";
import { useCreateSpace, useEnsureSpace, useSpaces } from "@/hooks/query/spaces";
import {
  emptyPortfolioSchema,
  emptyStructuredIntent,
  type Portfolio,
  type PortfolioSchema,
  type Space,
} from "@/lib/types";
import {
  ArrowLeft,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Mic,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Record-mode entry point. Step 1: pick a space (or let the system create one
 * automatically via quick start). Step 2: pick a portfolio inside that space
 * — or spin up a fresh one — and start dictating.
 */
export default function RecordEntryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <RecordEntry />
    </Suspense>
  );
}

function RecordEntry() {
  const searchParams = useSearchParams();
  const spaceId = searchParams.get("space");

  return spaceId ? (
    <PortfolioStep spaceId={spaceId} />
  ) : (
    <SpaceStep />
  );
}

// ---------------------------------------------------------------------------
// Step 1: choose (or auto-create) a space
// ---------------------------------------------------------------------------

function SpaceStep() {
  const router = useRouter();
  const { data: spaces, isLoading } = useSpaces();
  const ensureSpace = useEnsureSpace();
  const createSpace = useCreateSpace();
  const createPortfolio = useCreatePortfolio();

  const [newSpaceName, setNewSpaceName] = useState("");
  const [isQuickStarting, setIsQuickStarting] = useState(false);

  // Quick start: the system creates/reuses a space, creates a portfolio in
  // it, and drops the user straight into dictation — zero decisions upfront.
  const handleQuickStart = async () => {
    setIsQuickStarting(true);
    try {
      const space = await ensureSpace.mutateAsync({});
      const portfolio = await createPortfolio.mutateAsync({
        title: `Voice form — ${new Date().toLocaleDateString()}`,
        intent: emptyStructuredIntent(),
        schema: emptyPortfolioSchema(),
        space_id: space.id,
        status: "draft",
      });
      router.push(`/portfolios/${portfolio.id}/record`);
    } catch {
      setIsQuickStarting(false);
    }
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    const space = await createSpace.mutateAsync({ name: newSpaceName.trim() });
    router.push(`/record?space=${space.id}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl tracking-tight text-primary">
          <Mic className="h-5 w-5 text-brand-accent" />
          Record mode
        </h1>
        <p className="text-sm text-muted-foreground font-sans">
          Choose a space to work in — or just start talking and let the system
          set one up for you.
        </p>
      </div>

      {/* Quick start */}
      <Card className="flex flex-col items-start gap-3 border-brand-accent/30 bg-brand-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-brand-accent" />
            Start dictating now
          </h3>
          <p className="text-sm text-muted-foreground font-sans">
            A space and a fresh form are created automatically.
          </p>
        </div>
        <Button
          data-testid="quick-start-btn"
          onClick={handleQuickStart}
          disabled={isQuickStarting}
          className="btn-brand font-sans"
        >
          {isQuickStarting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Mic className="h-4 w-4 mr-2" />
          )}
          Quick start
        </Button>
      </Card>

      {/* Existing spaces */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-4 bg-muted rounded w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded w-full" />
            </Card>
          ))}
        </div>
      ) : spaces && spaces.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground font-sans">
          No spaces yet — create one below or use quick start.
        </p>
      )}

      {/* New space */}
      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <FolderPlus className="h-4 w-4 text-muted-foreground" />
          New space
        </h3>
        <div className="flex gap-2">
          <Input
            placeholder="e.g., Customer Research"
            value={newSpaceName}
            onChange={(e) => setNewSpaceName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateSpace()}
          />
          <Button
            onClick={handleCreateSpace}
            disabled={!newSpaceName.trim() || createSpace.isPending}
            variant="outline"
          >
            {createSpace.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SpaceCard({ space }: { space: Space }) {
  const { data: portfolios } = usePortfolios(space.id);
  const count = portfolios?.length ?? 0;

  return (
    <Link href={`/record?space=${space.id}`}>
      <Card className="group p-5 hover:border-primary/40 card-hover-lift cursor-pointer">
        <div className="mb-2 flex items-start justify-between">
          <h3 className="flex items-center gap-2 font-semibold truncate">
            <Folder className="h-4 w-4 shrink-0 text-brand-accent" />
            {space.name}
          </h3>
          {space.origin === "system" && (
            <Badge variant="outline" className="text-[10px]">
              auto
            </Badge>
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground line-clamp-2">
          {space.description || "No description"}
        </p>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            {count} form{count !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-brand-accent opacity-0 transition-opacity group-hover:opacity-100">
            Open
          </span>
        </div>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Step 2: choose a portfolio inside the space (or create one)
// ---------------------------------------------------------------------------

function PortfolioStep({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const { data: spaces } = useSpaces();
  const space = spaces?.find((s) => s.id === spaceId);
  const { data: portfolios, isLoading } = usePortfolios(spaceId);
  const createPortfolio = useCreatePortfolio();

  const handleNewVoiceForm = async () => {
    const portfolio = await createPortfolio.mutateAsync({
      title: `Voice form — ${new Date().toLocaleDateString()}`,
      intent: emptyStructuredIntent(),
      schema: emptyPortfolioSchema(),
      space_id: spaceId,
      status: "draft",
    });
    router.push(`/portfolios/${portfolio.id}/record`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/record"
            className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            All spaces
          </Link>
          <h1 className="flex items-center gap-2 text-2xl tracking-tight text-primary">
            <Folder className="h-5 w-5 text-brand-accent" />
            {space?.name ?? "Space"}
          </h1>
          <p className="text-sm text-muted-foreground font-sans">
            Pick a form to dictate into, or start a fresh one.
          </p>
        </div>
        <Button
          onClick={handleNewVoiceForm}
          disabled={createPortfolio.isPending}
          className="btn-brand font-sans"
        >
          {createPortfolio.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Mic className="h-4 w-4 mr-2" />
          )}
          New voice form
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-4 bg-muted rounded w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded w-full" />
            </Card>
          ))}
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((portfolio) => (
            <RecordCard key={portfolio.id} portfolio={portfolio} />
          ))}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">
            No forms in this space yet
          </h3>
          <p className="text-muted-foreground mb-4">
            Start a fresh one and shape it by voice.
          </p>
          <Button onClick={handleNewVoiceForm} disabled={createPortfolio.isPending}>
            <Mic className="h-4 w-4 mr-2" />
            New voice form
          </Button>
        </Card>
      )}
    </div>
  );
}

function RecordCard({ portfolio }: { portfolio: Portfolio }) {
  const fieldCount = (portfolio.schema as unknown as PortfolioSchema).fields
    .length;

  return (
    <Link href={`/portfolios/${portfolio.id}/record`}>
      <Card className="group p-5 hover:border-primary/40 card-hover-lift cursor-pointer">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold truncate">{portfolio.title}</h3>
          <Badge
            variant={portfolio.status === "published" ? "default" : "secondary"}
          >
            {portfolio.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {portfolio.intent.purpose.content || "No intent defined yet"}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span>
              {fieldCount} field{fieldCount !== 1 ? "s" : ""}
            </span>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium text-brand-accent opacity-0 transition-opacity group-hover:opacity-100">
            <Mic className="h-3 w-3" />
            Dictate
          </span>
        </div>
      </Card>
    </Link>
  );
}
