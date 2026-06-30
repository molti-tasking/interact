"use client";

import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/context/user-context";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useVoiceCapture } from "@/hooks/voice/useVoiceCapture";
import { formatActor } from "@/lib/mock-users";
import {
  emptyStructuredIntent,
  type PortfolioSchema,
  type StructuredIntent,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  ClipboardList,
  History,
  Loader2,
  Mic,
  Pencil,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type LogKind = "speech" | "processing" | "result" | "system" | "error";

interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
  at: string;
}

/**
 * Record mode — a full-screen, hands-free dictation surface for a single
 * portfolio. Each spoken phrase is transcribed, appended to the form's intent,
 * and run through the same pipeline the workspace uses, with every step echoed
 * into a live tracing log. Detail pages stay one click away in the top bar.
 */
export default function RecordModePage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading } = usePortfolio(id);
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const pipeline = usePipelineGenerate(id);

  const [log, setLog] = useState<LogEntry[]>([]);
  const logSeq = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Always patch onto the freshest persisted intent, even mid-flight.
  const latestIntentRef = useRef<StructuredIntent>(emptyStructuredIntent());
  useEffect(() => {
    if (portfolio) latestIntentRef.current = portfolio.intent;
  }, [portfolio]);

  const pushLog = useCallback((kind: LogKind, text: string) => {
    const entry: LogEntry = {
      id: `log-${logSeq.current++}`,
      kind,
      text,
      at: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
    setLog((prev) => [...prev, entry]);
  }, []);

  // Auto-scroll the log to the newest entry.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const handleTranscript = useCallback(
    async (text: string) => {
      pushLog("speech", text);
      if (!portfolio) return;

      const base = latestIntentRef.current;
      const nextIntent: StructuredIntent = {
        ...base,
        purpose: {
          content: base.purpose.content
            ? `${base.purpose.content}\n\n${text}`
            : text,
          updatedAt: new Date().toISOString(),
        },
      };

      pushLog("processing", "Updating the form from what you said…");
      try {
        const result = await pipeline.mutateAsync({
          previousIntent: base,
          currentIntent: nextIntent,
          currentSchema: portfolio.schema as unknown as PortfolioSchema,
          actor,
        });
        latestIntentRef.current = result.intent;

        if (result.strategy.kind === "noop") {
          pushLog("system", "No changes detected.");
        } else {
          const fieldCount = result.schema?.fields.length;
          pushLog(
            "result",
            fieldCount != null
              ? `Form updated (${result.strategy.kind}) — now ${fieldCount} field${fieldCount === 1 ? "" : "s"}.`
              : `Intent updated (${result.strategy.kind}).`,
          );
        }
      } catch (err) {
        pushLog(
          "error",
          err instanceof Error ? err.message : "Failed to update the form.",
        );
      }
    },
    [actor, pipeline, portfolio, pushLog],
  );

  const { isRecording, isTranscribing, error, start, stop } =
    useVoiceCapture(handleTranscript);

  useEffect(() => {
    if (error) pushLog("error", error);
  }, [error, pushLog]);

  const isBusy = isTranscribing || pipeline.isPending;
  const fieldCount =
    (portfolio?.schema as unknown as PortfolioSchema | undefined)?.fields
      .length ?? 0;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-muted-foreground">Portfolio not found.</p>
        <Button asChild variant="outline">
          <Link href="/record">Back to record mode</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top bar: identity + jump to detail pages + exit */}
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-7 items-center gap-1.5 rounded-full bg-brand-accent/10 px-2.5 text-[11px] font-medium text-brand-accent">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isRecording ? "animate-pulse bg-red-500" : "bg-brand-accent/50",
              )}
            />
            Record mode
          </span>
          <h1 className="truncate text-sm font-medium text-primary">
            {portfolio.title}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          <NavLink href={`/portfolios/${id}`} icon={<Pencil />}>
            Design
          </NavLink>
          <NavLink href={`/portfolios/${id}/provenance`} icon={<History />}>
            History
          </NavLink>
          <NavLink href={`/portfolios/${id}/dashboard`} icon={<BarChart3 />}>
            Dashboard
          </NavLink>
          <NavLink href={`/forms/${id}`} icon={<ClipboardList />}>
            Form
          </NavLink>
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="ml-1"
            title="Exit record mode"
          >
            <Link href={`/portfolios/${id}`} aria-label="Exit record mode">
              <X />
            </Link>
          </Button>
        </div>
      </header>

      {/* Body: record control + live tracing log */}
      <div className="grid flex-1 grid-rows-[1fr_auto] overflow-hidden md:grid-cols-[1fr_minmax(320px,420px)] md:grid-rows-1">
        {/* Record control */}
        <div className="flex flex-col items-center justify-center gap-6 p-8">
          <button
            type="button"
            onClick={() => (isRecording ? stop() : start())}
            disabled={isTranscribing}
            aria-pressed={isRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className={cn(
              "flex h-36 w-36 items-center justify-center rounded-full text-white shadow-lg transition-all disabled:opacity-60",
              isRecording
                ? "animate-pulse bg-red-500 hover:bg-red-600"
                : "bg-brand-accent hover:brightness-110",
            )}
          >
            {isTranscribing ? (
              <Loader2 className="h-12 w-12 animate-spin" />
            ) : isRecording ? (
              <Square className="h-12 w-12" />
            ) : (
              <Mic className="h-12 w-12" />
            )}
          </button>

          <div className="text-center">
            <p className="text-base font-medium text-primary">
              {isTranscribing
                ? "Transcribing…"
                : pipeline.isPending
                  ? "Updating the form…"
                  : isRecording
                    ? "Listening — tap to stop"
                    : "Tap to dictate"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground font-sans">
              Speak naturally about what this form should collect. {fieldCount}{" "}
              field{fieldCount === 1 ? "" : "s"} so far.
            </p>
          </div>
        </div>

        {/* Tracing log */}
        <aside className="flex min-h-0 flex-col border-t md:border-l md:border-t-0">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="workspace-section-label">Activity</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {log.length === 0 ? (
              <p className="mt-6 text-center text-sm text-muted-foreground font-sans">
                Your dictation and the form&apos;s responses will appear here.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {log.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
                <div ref={logEndRef} />
              </ul>
            )}
          </div>
          {isBusy && (
            <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Working…
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
    >
      <Link href={href}>
        {icon}
        <span className="hidden sm:inline">{children}</span>
      </Link>
    </Button>
  );
}

const LOG_STYLES: Record<LogKind, { label: string; className: string }> = {
  speech: { label: "You", className: "text-foreground" },
  processing: { label: "···", className: "text-muted-foreground" },
  result: { label: "Form", className: "text-brand-accent" },
  system: { label: "System", className: "text-muted-foreground" },
  error: { label: "Error", className: "text-destructive" },
};

function LogRow({ entry }: { entry: LogEntry }) {
  const style = LOG_STYLES[entry.kind];
  return (
    <li className="flex gap-2.5 text-sm">
      <span className="w-12 shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground/60">
        {entry.at}
      </span>
      <div className="min-w-0">
        <span
          className={cn(
            "mr-1.5 text-[10px] font-medium uppercase tracking-wide",
            style.className,
          )}
        >
          {style.label}
        </span>
        <span
          className={cn(
            "font-sans",
            entry.kind === "speech" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {entry.text}
        </span>
      </div>
    </li>
  );
}
