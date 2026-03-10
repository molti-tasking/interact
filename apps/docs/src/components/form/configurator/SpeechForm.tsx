"use client";

import { OpinionInteraction } from "@/app/actions/opinion-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const SpeechForm = () => {
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );
  if (!opinionInteractions || opinionInteractions.length === 0) {
    return null;
  }

  // Hide resolved interactions, but keep the currently loading one visible
  const visibleInteractions = opinionInteractions.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  );

  if (visibleInteractions.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p>Interactions: {visibleInteractions.length}</p>
      {visibleInteractions.map((interaction) => (
        <SpeechFormEntry
          interaction={interaction}
          key={interaction.id}
          index={opinionInteractions.indexOf(interaction)}
        />
      ))}
    </div>
  );
};

const SpeechFormEntry = ({
  interaction,
  index,
}: {
  interaction: OpinionInteraction;
  index: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );
  const basePromptElement = useConfiguratorStore((s) => s.basePromptElement);
  const basePromptActive = useConfiguratorStore((s) => s.basePromptActive);
  const onOpinionInteraction = useConfiguratorStore(
    (s) => s.onOpinionInteraction,
  );
  const dismissOpinionInteraction = useConfiguratorStore(
    (s) => s.dismissOpinionInteraction,
  );
  const anyLoading = opinionInteractions.some((i) => i.status === "loading");
  const [animating, setAnimating] = useState(false);

  const onAnimate = () => {
    if (basePromptElement && ref.current) setAnimating(true);
  };

  // Clear animation when basePromptActive ends
  useEffect(() => {
    if (!basePromptActive && animating) {
      const timer = setTimeout(() => setAnimating(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [basePromptActive, animating]);

  return (
    <>
      {animating && (
        <ParticleOverlay cardRef={ref} targetRef={basePromptElement} />
      )}
      <Card
        key={interaction.id}
        className={interaction.status === "loading" ? "opacity-60" : ""}
        ref={ref}
        onClick={onAnimate}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {interaction.text}
            </CardTitle>
            <div className="flex items-center gap-1">
              {interaction.status === "loading" && (
                <Badge variant="secondary" className="text-xs">
                  Updating...
                </Badge>
              )}
              {interaction.status === "pending" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissOpinionInteraction(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {interaction.options.map((option) => (
              <Button
                key={option.value}
                variant={
                  interaction.selectedOption === option.value
                    ? "default"
                    : "outline"
                }
                size="sm"
                disabled={interaction.status !== "pending" || anyLoading}
                onClick={() => onOpinionInteraction(index, option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
};

const PARTICLE_COUNT = 28;

function buildParticles(origin: DOMRect, target: DOMRect) {
  const dx = Math.abs(
    origin.left + origin.width / 2 - (target.left + target.width / 2),
  );
  const dy = Math.abs(
    origin.top + origin.height / 2 - (target.top + target.height / 2),
  );
  // Scale spread to ~15% of the travel distance, clamped to a reasonable range
  const spread = Math.max(20, Math.min(80, Math.max(dx, dy) * 0.15));

  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const startX = origin.left + Math.random() * origin.width;
    const startY = origin.top + Math.random() * origin.height;
    const endX = target.left + Math.random() * target.width;
    const endY = target.top + Math.random() * target.height;
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const cpx = midX + (Math.random() - 0.5) * spread;
    const cpy = midY + (Math.random() - 0.5) * spread * 0.5;
    return {
      path: `M ${startX} ${startY} Q ${cpx} ${cpy} ${endX} ${endY}`,
      delay: Math.random() * 300,
      duration: 600 + Math.random() * 500,
      size: 2 + Math.random() * 4,
      id: i,
    };
  });
}

const ParticleOverlay = ({
  cardRef,
  targetRef,
}: {
  cardRef: React.RefObject<HTMLDivElement | null>;
  targetRef: HTMLTextAreaElement | null;
}) => {
  const [state, setState] = useState<{
    originRect: DOMRect;
    particles: ReturnType<typeof buildParticles>;
    key: number;
  } | null>(null);

  // Regenerate particles periodically and whenever scroll/resize happens
  useEffect(() => {
    if (!cardRef.current || !targetRef) return;

    const refresh = () => {
      if (!cardRef.current || !targetRef) return;
      const origin = cardRef.current.getBoundingClientRect();
      const target = targetRef.getBoundingClientRect();
      setState((prev) => ({
        originRect: origin,
        particles: buildParticles(origin, target),
        key: (prev?.key ?? 0) + 1,
      }));
    };

    refresh();
    const interval = setInterval(refresh, 1100);

    // Track scroll on the nearest scrollable ancestor and window
    const scrollParent =
      cardRef.current.closest("[data-radix-scroll-area-viewport]") ??
      cardRef.current.closest(
        ".overflow-auto, .overflow-y-auto, .overflow-scroll",
      ) ??
      window;

    const onScroll = () => {
      if (!cardRef.current || !targetRef) return;
      setState((prev) => {
        if (!prev) return prev;
        const origin = cardRef.current!.getBoundingClientRect();
        return { ...prev, originRect: origin };
      });
    };

    scrollParent.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      clearInterval(interval);
      scrollParent.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [cardRef, targetRef]);

  if (!state) return null;

  const { originRect, particles, key } = state;
  const perim = 2 * (originRect.width + originRect.height);
  const dashLen = perim * 0.2;
  const rx = 10;

  return createPortal(
    <svg
      style={{ position: "fixed", inset: 0, pointerEvents: "none" }}
      width="100%"
      height="100%"
    >
      <rect
        x={originRect.left}
        y={originRect.top}
        width={originRect.width}
        height={originRect.height}
        rx={rx}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={`${dashLen} ${perim - dashLen}`}
        opacity="0"
      >
        <animate
          attributeName="stroke-dashoffset"
          values={`${perim};0`}
          dur="800ms"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0;0.7;0.7;0"
          keyTimes="0;0.1;0.7;1"
          dur="1000ms"
          repeatCount="indefinite"
        />
      </rect>
      {particles.map((p) => (
        <circle
          key={`${key}-${p.id}`}
          cx="0"
          cy="0"
          r={p.size}
          fill="currentColor"
          opacity="0"
        >
          <animateMotion
            path={p.path}
            dur={`${p.duration}ms`}
            begin={`${p.delay}ms`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;0.6;0.4;0"
            dur={`${p.duration}ms`}
            begin={`${p.delay}ms`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>,
    document.body,
  );
};
