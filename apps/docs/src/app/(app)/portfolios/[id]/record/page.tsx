"use client";

import { Button } from "@/components/ui/button";
import {
  WaterBackground,
  type WaterHandle,
} from "@/components/voice/WaterBackground";
import { useCurrentUser } from "@/context/user-context";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useSpace } from "@/hooks/query/spaces";
import {
  useUtteranceProcessor,
  type UtteranceEventKind,
} from "@/hooks/voice/useUtteranceProcessor";
import { useLiveVoiceCapture } from "@/hooks/voice/useLiveVoiceCapture";
import { formatActor } from "@/lib/mock-users";
import {
  emptyPortfolioSchema,
  emptyStructuredIntent,
  type PortfolioSchema,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  loadVoiceMode,
  saveVoiceMode,
  VOICE_MODES,
  type VoiceInteractionMode,
} from "@/lib/voice-modes";
import {
  BarChart3,
  Check,
  ClipboardList,
  Folder,
  History,
  Loader2,
  Mic,
  Pencil,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Ambient water background. Flip to `false` to remove it entirely. */
const WATER_ENABLED = true;

type LogKind = "speech" | UtteranceEventKind;

interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
  at: string;
}

interface PendingReview {
  id: string;
  text: string;
}

/**
 * Record mode — a full-screen, hands-free dictation surface for a single
 * portfolio. Spoken phrases are transcribed and applied through one of three
 * interaction variants (smart routing, raw append, or review-first); all
 * processing is serialized through an utterance queue so phrases spoken while
 * the pipeline is busy are queued instead of lost.
 */
export default function RecordModePage() {
  const { id } = useParams<{ id: string }>();
  const { data: portfolio, isLoading } = usePortfolio(id);
  const { data: space } = useSpace(portfolio?.space_id);
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);

  const [mode, setMode] = useState<VoiceInteractionMode>("smart");
  useEffect(() => setMode(loadVoiceMode()), []);
  const changeMode = (next: VoiceInteractionMode) => {
    setMode(next);
    saveVoiceMode(next);
  };

  const [log, setLog] = useState<LogEntry[]>([]);
  const logSeq = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const reviewSeq = useRef(0);

  // Live, unfinalized speech from the browser recognizer — shown as you talk,
  // then replaced by the authoritative Whisper transcript once the phrase ends.
  const [interim, setInterim] = useState("");

  const waterRef = useRef<WaterHandle>(null);

  const processor = useUtteranceProcessor(id, {
    intent: portfolio?.intent ?? emptyStructuredIntent(),
    schema:
      (portfolio?.schema as unknown as PortfolioSchema) ??
      emptyPortfolioSchema(),
  });

  // Adopt fresh server state whenever the queue is idle.
  useEffect(() => {
    if (portfolio) {
      processor.sync({
        intent: portfolio.intent,
        schema: portfolio.schema as unknown as PortfolioSchema,
      });
    }
    // processor.sync is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const applyUtterance = useCallback(
    (text: string, processingMode: "append" | "smart") => {
      processor.enqueue({
        text,
        mode: processingMode,
        actor,
        onEvent: pushLog,
        onSchemaChange: (diff, strategyKind) => {
          const water = waterRef.current;
          if (!water) return;
          // A wholesale reshape swells the surface; added fields rain down
          // (capped so a big regeneration never looks chaotic); removed
          // fields sink out.
          if (strategyKind === "full" || strategyKind === "voice_edit") {
            water.splash(diff.added.length + diff.removed.length);
          }
          if (diff.added.length > 0) {
            water.drop(Math.min(diff.added.length, 6));
          }
          if (diff.removed.length > 0) {
            water.sink(diff.removed.length);
          }
        },
      });
    },
    [actor, processor, pushLog],
  );

  const handleTranscript = useCallback(
    (text: string) => {
      pushLog("speech", text);
      if (!portfolio) return;

      if (mode === "review") {
        setPendingReviews((prev) => [
          ...prev,
          { id: `review-${reviewSeq.current++}`, text },
        ]);
        return;
      }

      applyUtterance(text, mode);
    },
    [applyUtterance, mode, portfolio, pushLog],
  );

  const approveReview = useCallback(
    (review: PendingReview, editedText: string) => {
      setPendingReviews((prev) => prev.filter((r) => r.id !== review.id));
      applyUtterance(editedText.trim(), "smart");
    },
    [applyUtterance],
  );

  const discardReview = useCallback((reviewId: string) => {
    setPendingReviews((prev) => prev.filter((r) => r.id !== reviewId));
  }, []);

  const { isRecording, isTranscribing, liveSupported, error, start, stop } =
    useLiveVoiceCapture({
      onSegment: handleTranscript,
      onInterim: setInterim,
    });

  useEffect(() => {
    if (error) pushLog("error", error);
  }, [error, pushLog]);

  const isBusy = isTranscribing || processor.isProcessing;
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
      {/* Ambient water background — reacts to schema changes as you dictate. */}
      <WaterBackground ref={waterRef} enabled={WATER_ENABLED} />

      {/* Top bar: identity + jump to detail pages + exit */}
      <header className="relative z-10 flex items-center justify-between border-b px-5 py-3">
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
          {space && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{space.name}</span>
              <span className="text-muted-foreground/50">/</span>
            </span>
          )}
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
      <div className="relative z-10 grid flex-1 grid-rows-[1fr_auto] overflow-hidden md:grid-cols-[1fr_minmax(320px,420px)] md:grid-rows-1">
        {/* Record control */}
        <div className="flex flex-col items-center justify-center gap-6 p-8">
          {/* Interaction variant switcher */}
          <div
            role="radiogroup"
            aria-label="Voice interaction mode"
            className="flex items-center gap-1 rounded-full border bg-muted/40 p-1"
          >
            {VOICE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                title={m.description}
                onClick={() => changeMode(m.id)}
                className={cn(
                  "rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                  mode === m.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => (isRecording ? stop() : start())}
            aria-pressed={isRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
            className={cn(
              "flex h-36 w-36 items-center justify-center rounded-full text-white shadow-lg transition-all disabled:opacity-60",
              isRecording
                ? "animate-pulse bg-red-500 hover:bg-red-600"
                : "bg-brand-accent hover:brightness-110",
            )}
          >
            {/* Recording takes visual priority — transcription now runs *while*
                recording, so we keep showing Stop rather than a spinner. */}
            {isRecording ? (
              <Square className="h-12 w-12" />
            ) : isTranscribing ? (
              <Loader2 className="h-12 w-12 animate-spin" />
            ) : (
              <Mic className="h-12 w-12" />
            )}
          </button>

          <div className="text-center">
            <p className="text-base font-medium text-primary">
              {isRecording
                ? "Listening — tap to stop"
                : isTranscribing
                  ? "Transcribing…"
                  : processor.isProcessing
                    ? "Updating the form — keep dictating"
                    : "Tap to dictate"}
            </p>

            {/* Live caption: the browser's interim words while you speak. */}
            <p
              className={cn(
                "mt-2 min-h-[1.5rem] text-sm font-sans italic transition-colors",
                interim ? "text-brand-accent" : "text-transparent",
              )}
              aria-live="polite"
            >
              {interim || " "}
            </p>

            <p className="mt-1 text-sm text-muted-foreground font-sans">
              Speak naturally about what this form should collect. {fieldCount}{" "}
              field{fieldCount === 1 ? "" : "s"} so far.
              {processor.queueLength > 1 &&
                ` ${processor.queueLength - 1} phrase${processor.queueLength === 2 ? "" : "s"} queued.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70 font-sans max-w-sm">
              {VOICE_MODES.find((m) => m.id === mode)?.description}
            </p>

            {!liveSupported && (
              <p className="mt-2 text-xs text-amber-600/80 font-sans max-w-sm">
                Live captions and real-time processing need a Chromium browser
                (Chrome/Edge). Here, speech is transcribed when you tap stop.
              </p>
            )}
          </div>

          {/* Review-mode confirmation cards */}
          {pendingReviews.length > 0 && (
            <div className="w-full max-w-md space-y-2">
              {pendingReviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  onApprove={approveReview}
                  onDiscard={discardReview}
                />
              ))}
            </div>
          )}
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

function ReviewCard({
  review,
  onApprove,
  onDiscard,
}: {
  review: PendingReview;
  onApprove: (review: PendingReview, editedText: string) => void;
  onDiscard: (reviewId: string) => void;
}) {
  const [text, setText] = useState(review.text);

  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2 text-left shadow-sm">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        aria-label="Edit transcript before applying"
        className="w-full resize-none rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDiscard(review.id)}
          className="text-muted-foreground"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Discard
        </Button>
        <Button
          size="sm"
          disabled={!text.trim()}
          onClick={() => onApprove(review, text)}
          className="btn-brand font-sans"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          Apply
        </Button>
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
