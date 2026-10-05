"use client";

import { Button } from "@/components/ui/button";
import {
  WaterBackground,
  type WaterHandle,
} from "@/components/voice/WaterBackground";
import { useCurrentUser } from "@/context/user-context";
import { usePortfolio, usePortfolioSummaries } from "@/hooks/query/portfolios";
import { useSpace } from "@/hooks/query/spaces";
import { useUndoToast } from "@/hooks/query/undo";
import { useLiveVoiceCapture } from "@/hooks/voice/useLiveVoiceCapture";
import {
  useUtteranceProcessor,
  type UtteranceEventKind,
} from "@/hooks/voice/useUtteranceProcessor";
import { formatActor } from "@/lib/mock-users";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  CAPTURE_MODES,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_VOICE_MODE,
  loadCaptureMode,
  loadVoiceMode,
  saveCaptureMode,
  saveVoiceMode,
  VOICE_MODES,
  type CaptureMode,
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
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** Ambient water background. Flip to `false` to remove it entirely. */
const WATER_ENABLED = true;

/** Keep the activity log bounded during long sessions. */
const MAX_LOG_ENTRIES = 200;

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
 * Tiny external store for the live caption, so the many interim updates per
 * second re-render only the caption — not the page, log, or background.
 */
function createTextStore() {
  let value = "";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: string) => {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type TextStore = ReturnType<typeof createTextStore>;

// Voice/capture mode preferences live in localStorage; this tiny pub/sub
// lets the page read them with useSyncExternalStore (no setState-in-effect).
const prefListeners = new Set<() => void>();
function subscribePrefs(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function notifyPrefs() {
  prefListeners.forEach((l) => l());
}

/** Elements where Space has its own meaning (typing, pressing, choosing). */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="radio"], [role="checkbox"], [role="textbox"], [role="menuitem"], [role="tab"], [role="switch"]',
  );
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
  const notifyUndo = useUndoToast();

  // Persisted choices, read hydration-safely from localStorage.
  const mode = useSyncExternalStore(
    subscribePrefs,
    loadVoiceMode,
    () => DEFAULT_VOICE_MODE,
  );
  const captureMode = useSyncExternalStore(
    subscribePrefs,
    loadCaptureMode,
    () => DEFAULT_CAPTURE_MODE,
  );
  const changeMode = (next: VoiceInteractionMode) => {
    saveVoiceMode(next);
    notifyPrefs();
  };
  const changeCaptureMode = (next: CaptureMode) => {
    saveCaptureMode(next);
    notifyPrefs();
  };

  const [log, setLog] = useState<LogEntry[]>([]);
  const logSeq = useRef(0);

  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const reviewSeq = useRef(0);

  // Live, unfinalized speech from the browser recognizer — shown as you talk,
  // then replaced by the authoritative Whisper transcript once the phrase ends.
  const [caption] = useState(createTextStore);

  const waterRef = useRef<WaterHandle>(null);

  // Sibling tables in the same space are candidate targets for dictated
  // reference fields ("link each item to a product template").
  const { data: spacePortfolios } = usePortfolioSummaries(portfolio?.space_id);
  const spaceId = portfolio?.space_id;
  const siblings = useMemo(
    () =>
      (spaceId ? (spacePortfolios ?? []) : [])
        .filter((p) => p.id !== id)
        .map((p) => ({ id: p.id, title: p.title })),
    [spaceId, spacePortfolios, id],
  );

  const processor = useUtteranceProcessor(
    id,
    {
      intent: portfolio?.intent ?? emptyStructuredIntent(),
      schema: portfolio?.schema ?? emptyPortfolioSchema(),
      revision: portfolio?.revision,
    },
    { siblings },
  );
  const { sync, enqueue } = processor;

  // Adopt fresh server state (always when idle; when newer while busy).
  useEffect(() => {
    if (portfolio) {
      sync({
        intent: portfolio.intent,
        schema: portfolio.schema,
        revision: portfolio.revision,
      });
    }
  }, [portfolio, sync]);

  // Every event gets its own entry (repeated failures stay visible).
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
    setLog((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_LOG_ENTRIES
        ? next.slice(next.length - MAX_LOG_ENTRIES)
        : next;
    });
  }, []);

  const applyUtterance = useCallback(
    (text: string, processingMode: "append" | "smart") => {
      enqueue({
        text,
        mode: processingMode,
        actor,
        onEvent: pushLog,
        onCommit: (result, label) => notifyUndo(result, label),
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
    [actor, enqueue, notifyUndo, pushLog],
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

  const handleCaptureError = useCallback(
    (message: string, { soft }: { soft: boolean }) =>
      pushLog(soft ? "system" : "error", message),
    [pushLog],
  );

  const {
    isRecording,
    isStarting,
    isTranscribing,
    liveSupported,
    liveActive,
    error,
    toggle,
  } = useLiveVoiceCapture({
    onSegment: handleTranscript,
    onInterim: caption.set,
    onError: handleCaptureError,
    mode: captureMode,
  });

  // Space toggles recording unless focus is somewhere Space means something.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const isBusy = isTranscribing || processor.isProcessing;
  const fieldCount = portfolio?.schema.fields.length ?? 0;
  const activeCapture = CAPTURE_MODES.find((m) => m.id === captureMode);

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

  const status = isStarting
    ? "Waiting for the microphone…"
    : isRecording
      ? "Listening — tap or press Space to stop"
      : isTranscribing
        ? "Transcribing…"
        : processor.isProcessing
          ? "Updating the form — keep dictating"
          : "Tap or press Space to dictate";

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
                isRecording
                  ? "bg-red-500 motion-safe:animate-pulse"
                  : "bg-brand-accent/50",
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
        <div className="flex flex-col items-center justify-center gap-6 overflow-y-auto p-8">
          <div className="flex flex-wrap items-center justify-center gap-2">
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

            {/* Capture variant: private (Whisper only) vs live captions */}
            <div
              role="radiogroup"
              aria-label="Speech capture"
              className="flex items-center gap-1 rounded-full border bg-muted/40 p-1"
            >
              {CAPTURE_MODES.map((m) => {
                const unavailable = m.id === "live" && !liveSupported;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={captureMode === m.id}
                    disabled={isRecording || isStarting || unavailable}
                    title={
                      unavailable
                        ? "This browser has no speech recognition (e.g. Firefox) — Private is used."
                        : isRecording
                          ? "Stop recording to switch."
                          : m.description
                    }
                    onClick={() => changeCaptureMode(m.id)}
                    className={cn(
                      "flex items-center gap-1 rounded-full px-3.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      captureMode === m.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.id === "private" && <ShieldCheck className="h-3 w-3" />}
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeCapture?.privacyNotice && liveSupported && (
            <p className="max-w-md rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-center text-xs text-amber-700 font-sans dark:text-amber-400">
              {activeCapture.privacyNotice}
            </p>
          )}

          <button
            type="button"
            onClick={toggle}
            aria-pressed={isRecording || isStarting}
            aria-label="Record"
            aria-keyshortcuts="Space"
            className={cn(
              "flex h-36 w-36 items-center justify-center rounded-full text-white shadow-lg transition-all",
              isRecording || isStarting
                ? "bg-red-500 hover:bg-red-600 motion-safe:animate-pulse"
                : "bg-brand-accent hover:brightness-110",
            )}
          >
            {/* Recording takes visual priority — transcription runs *while*
                recording, so we keep showing Stop rather than a spinner. */}
            {isRecording || isStarting ? (
              <Square className="h-12 w-12" />
            ) : isTranscribing ? (
              <Loader2 className="h-12 w-12 motion-safe:animate-spin" />
            ) : (
              <Mic className="h-12 w-12" />
            )}
          </button>

          {/* Backed panel: the water rises behind this text as the form grows */}
          <div className="relative z-10 max-w-md rounded-2xl bg-background/80 px-4 py-3 text-center backdrop-blur-sm">
            <p
              className="text-base font-medium text-primary"
              role="status"
              aria-live="polite"
            >
              {status}
            </p>

            {/* Live caption (visual only — deliberately not a live region:
                it changes many times a second, and speech output could be
                picked up by the microphone). */}
            {liveActive && <LiveCaption store={caption} />}

            {error && (
              <p className="mx-auto mt-2 max-w-sm text-sm text-destructive font-sans">
                {error}
              </p>
            )}

            <p className="mt-1 text-sm text-muted-foreground font-sans">
              Speak naturally about what this form should collect. {fieldCount}{" "}
              field{fieldCount === 1 ? "" : "s"} so far.
              {processor.queueLength > 1 &&
                ` ${processor.queueLength - 1} phrase${processor.queueLength === 2 ? "" : "s"} queued.`}
            </p>
            <p className="mx-auto mt-1 text-xs text-muted-foreground max-w-sm">
              {VOICE_MODES.find((m) => m.id === mode)?.description}{" "}
              {activeCapture?.description}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Press{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                Space
              </kbd>{" "}
              to start or stop recording.
            </p>

            {captureMode === "live" && !liveSupported && (
              <p className="mt-2 text-xs text-amber-600/80 font-sans max-w-sm">
                This browser has no speech recognition (e.g. Firefox), so there
                are no live captions — phrases are detected from your pauses and
                transcribed by Whisper only.
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
            <span className="workspace-section-label" id="activity-log-label">
              Activity
            </span>
          </div>
          <ActivityLog entries={log} />
          {isBusy && (
            <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 motion-safe:animate-spin" />
              Working…
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function LiveCaption({ store }: { store: TextStore }) {
  const text = useSyncExternalStore(store.subscribe, store.get, () => "");
  return (
    <p
      className={cn(
        "mt-2 min-h-6 text-sm font-sans italic transition-colors",
        text ? "text-brand-accent" : "text-transparent",
      )}
    >
      {text || " "}
    </p>
  );
}

const ActivityLog = memo(function ActivityLog({
  entries,
}: {
  entries: LogEntry[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new entries only while the reader is at the bottom.
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [entries]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-3"
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {entries.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground font-sans">
          Your dictation and the form&apos;s responses will appear here.
        </p>
      ) : null}
      <ul
        role="log"
        aria-live="polite"
        aria-labelledby="activity-log-label"
        className="space-y-2.5"
      >
        {entries.map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
});

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
