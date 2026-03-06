"use client";

import { OpinionInteraction } from "@/app/actions/opinion-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const SpeechForm = () => {
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );

  if (!opinionInteractions || opinionInteractions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {opinionInteractions.map((interaction, index) => (
        <SpeechFormEntry
          interaction={interaction}
          key={interaction.id}
          index={index}
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
  const onOpinionInteraction = useConfiguratorStore(
    (s) => s.onOpinionInteraction,
  );
  const anyLoading = opinionInteractions.some((i) => i.status === "loading");
  const [animData, setAnimData] = useState<{
    particles: {
      path: string;
      delay: number;
      duration: number;
      size: number;
      id: number;
    }[];
    originRect: DOMRect;
  } | null>(null);

  const onAnimate = () => {
    if (!basePromptElement || !ref.current) return;
    const origin = ref.current.getBoundingClientRect();
    const target = basePromptElement.getBoundingClientRect();
    const count = 28;
    setAnimData({
      originRect: origin,
      particles: Array.from({ length: count }, (_, i) => {
        const startX = origin.left + Math.random() * origin.width;
        const startY = origin.top + Math.random() * origin.height;
        const endX = target.left + Math.random() * target.width;
        const endY = target.top + Math.random() * target.height;
        const midY = (startY + endY) / 2;
        const cpx = (startX + endX) / 2 + (Math.random() - 0.5) * 120;
        return {
          path: `M ${startX} ${startY} Q ${cpx} ${midY} ${endX} ${endY}`,
          delay: Math.random() * 300,
          duration: 600 + Math.random() * 500,
          size: 2 + Math.random() * 4,
          id: i,
        };
      }),
    });
  };

  return (
    <>
      {animData && (
        <ParticleOverlay
          particles={animData.particles}
          originRect={animData.originRect}
          onComplete={() => setAnimData(null)}
        />
      )}
      <Card
        key={interaction.id}
        className={interaction.status === "resolved" ? "opacity-60" : ""}
        ref={ref}
        onClick={onAnimate}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {interaction.text}
            </CardTitle>
            {interaction.status === "loading" && (
              <Badge variant="secondary" className="text-xs">
                Updating...
              </Badge>
            )}
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

const ParticleOverlay = ({
  particles,
  originRect,
  onComplete,
}: {
  particles: {
    path: string;
    delay: number;
    duration: number;
    size: number;
    id: number;
  }[];
  originRect: DOMRect;
  onComplete: () => void;
}) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1200);
    return () => clearTimeout(timer);
  }, [onComplete]);

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
          fill="freeze"
        />
        <animate
          attributeName="opacity"
          values="0;0.7;0.7;0"
          keyTimes="0;0.1;0.7;1"
          dur="1000ms"
          fill="freeze"
        />
      </rect>
      {particles.map((p) => (
        <circle
          key={p.id}
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
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            values="0;0.6;0.4;0"
            dur={`${p.duration}ms`}
            begin={`${p.delay}ms`}
            fill="freeze"
          />
        </circle>
      ))}
    </svg>,
    document.body,
  );
};
