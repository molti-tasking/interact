"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;
/** Horizontal padding around the paper, in px (matches `px-8`). */
const PAPER_GUTTER = 32;
const DOT_SPACING = 20;

/**
 * Scroll `el` into view within its canvas only — `scrollIntoView` would
 * also scroll the page, moving the sticky canvas and the deck around.
 */
export function scrollIntoCanvasView(
  el: HTMLElement,
  { block, smooth }: { block: "center" | "nearest"; smooth: boolean },
) {
  const scroller = el.closest<HTMLElement>("[data-canvas-scroller]");
  if (!scroller) return;
  const box = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  // Keep clear of the floating toolbar and notices at the top
  const top = view.top + 96;
  const bottom = view.bottom - 24;
  let delta = 0;
  if (block === "center") {
    delta = box.top + box.height / 2 - (top + bottom) / 2;
  } else if (box.top < top) {
    delta = box.top - top;
  } else if (box.bottom > bottom) {
    delta = Math.min(box.bottom - bottom, box.top - top);
  }
  if (Math.abs(delta) < 1) return;
  scroller.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
}

const clampZoom = (z: number) =>
  Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 100) / 100;

interface ArtifactCanvasProps {
  /** Floating bar across the top of the canvas */
  toolbar?: React.ReactNode;
  /** Floating notices under the toolbar (centered) */
  overlay?: React.ReactNode;
  /** The paper's content */
  children: React.ReactNode;
  /** Below this the canvas scrolls sideways instead of squeezing the paper */
  minPaperWidth?: number;
  className?: string;
}

/**
 * A dotted canvas with the artifact as a centered sheet of paper that fills
 * the canvas width at 100%. Pan by scrolling or by dragging the empty
 * canvas; zoom with Cmd/Ctrl + scroll, pinch, or the toolbar.
 *
 * Zoom uses CSS `zoom` rather than a transform, so layout, scroll extents,
 * `scrollIntoView` and hit-testing of the form inside keep working.
 */
export function ArtifactCanvas({
  toolbar,
  overlay,
  children,
  minPaperWidth = 480,
  className,
}: ArtifactCanvasProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  const paperWidth = Math.max(minPaperWidth, availableWidth ?? 0);

  // The paper's 100% width is whatever the canvas has room for
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setAvailableWidth(el.clientWidth - PAPER_GUTTER * 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  // Cmd/Ctrl + wheel (and trackpad pinch, which arrives as ctrl + wheel).
  // Needs a non-passive listener to stop the browser from zooming the page.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.01)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag the empty canvas (not the paper) to pan.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el || e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as HTMLElement).closest("[data-canvas-paper]")) return;
    // Leave the scrollbars to the browser
    const rect = el.getBoundingClientRect();
    if (
      e.clientX - rect.left >= el.clientWidth ||
      e.clientY - rect.top >= el.clientHeight
    ) {
      return;
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el || !drag.current) return;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPanning(false);
  };

  const dot = DOT_SPACING * zoom;

  return (
    <div
      data-testid="artifact-canvas"
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-2xl border bg-canvas",
        className,
      )}
    >
      <div
        ref={scrollerRef}
        data-canvas-scroller
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={cn(
          "absolute inset-0 overflow-auto overscroll-contain",
          panning ? "cursor-grabbing select-none" : "cursor-grab",
        )}
        style={{
          backgroundImage:
            "radial-gradient(var(--canvas-dot) 1px, transparent 1px)",
          backgroundSize: `${dot}px ${dot}px`,
          backgroundAttachment: "local",
        }}
      >
        <div className="w-max min-w-full px-8 pt-24 pb-24">
          <div
            data-canvas-paper
            className={cn(
              "mx-auto cursor-auto rounded-xl border bg-card shadow-sm",
              availableWidth === null && "w-full",
            )}
            style={{
              width: availableWidth === null ? undefined : paperWidth,
              zoom,
            }}
          >
            {children}
          </div>
        </div>
      </div>

      {toolbar && (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 *:pointer-events-auto">
          {toolbar}
        </div>
      )}

      {overlay && (
        <div className="pointer-events-none absolute inset-x-3 top-14 flex flex-col items-center gap-2 *:pointer-events-auto">
          {overlay}
        </div>
      )}

      <div
        role="toolbar"
        aria-label="Canvas zoom"
        className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border bg-background/90 p-0.5 shadow-sm backdrop-blur"
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Reset to 100%"
          aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
          className="h-7 min-w-11 rounded-md px-1 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
