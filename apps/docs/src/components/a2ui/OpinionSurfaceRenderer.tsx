"use client";

import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import type { A2UIMessage, ActionPayload } from "@a2ui-sdk/types/0.9";
import type { StreamableValue } from "ai/rsc";
import { readStreamableValue } from "ai/rsc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { A2UISurface } from "./A2UISurface";

interface OpinionSurfaceRendererProps {
  /** The streamable value from streamOpinionSurfacesAction */
  streamValue: StreamableValue<string> | null;
}

/**
 * Consumes a JSONL text stream of A2UI messages, parses them into
 * per-surface message arrays, and renders each opinion as an A2UISurface.
 * Maps A2UI action events back to the configurator store.
 */
export function OpinionSurfaceRenderer({
  streamValue,
}: OpinionSurfaceRendererProps) {
  const [surfaceMessages, setSurfaceMessages] = useState<
    Map<string, A2UIMessage[]>
  >(new Map());
  const [isStreaming, setIsStreaming] = useState(false);
  const bufferRef = useRef("");
  const store = useConfiguratorStore();

  // Parse JSONL stream into per-surface message groups
  useEffect(() => {
    if (!streamValue) return;

    let cancelled = false;
    setIsStreaming(true);
    setSurfaceMessages(new Map());
    bufferRef.current = "";

    (async () => {
      try {
        for await (const chunk of readStreamableValue(streamValue)) {
          if (cancelled) break;
          if (!chunk) continue;

          bufferRef.current += chunk;
          const lines = bufferRef.current.split("\n");
          // Keep the last incomplete line in buffer
          bufferRef.current = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const msg = JSON.parse(trimmed) as A2UIMessage;
              const surfaceId = extractSurfaceId(msg);
              if (!surfaceId) continue;

              setSurfaceMessages((prev) => {
                const next = new Map(prev);
                const existing = next.get(surfaceId) ?? [];
                next.set(surfaceId, [...existing, msg]);
                return next;
              });
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Process any remaining buffer
        if (bufferRef.current.trim()) {
          try {
            const msg = JSON.parse(bufferRef.current.trim()) as A2UIMessage;
            const surfaceId = extractSurfaceId(msg);
            if (surfaceId) {
              setSurfaceMessages((prev) => {
                const next = new Map(prev);
                const existing = next.get(surfaceId) ?? [];
                next.set(surfaceId, [...existing, msg]);
                return next;
              });
            }
          } catch {
            // ignore
          }
        }
      } finally {
        if (!cancelled) setIsStreaming(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streamValue]);

  // Handle A2UI action events from opinion buttons
  const handleAction = useCallback(
    async (action: ActionPayload) => {
      if (action.name !== "resolve") return;

      const ctx = action.context as {
        interactionIndex?: number;
        selectedValue?: string;
        selectedLabel?: string;
        dimensionName?: string;
        questionText?: string;
      };

      if (ctx.interactionIndex === undefined || !ctx.selectedValue) return;

      // Delegate to store's opinion interaction handler
      await store.onOpinionInteraction(ctx.interactionIndex, ctx.selectedValue);
    },
    [store],
  );

  const surfaceEntries = useMemo(
    () => Array.from(surfaceMessages.entries()),
    [surfaceMessages],
  );

  if (surfaceEntries.length === 0 && !isStreaming) return null;

  return (
    <div className="flex flex-col gap-3">
      {isStreaming && surfaceEntries.length === 0 && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Generating opinion cards...
        </p>
      )}
      {surfaceEntries.map(([surfaceId, messages]) => (
        <A2UISurface
          key={surfaceId}
          messages={messages}
          surfaceId={surfaceId}
          onAction={handleAction}
          // className="rounded-lg border bg-card text-card-foreground shadow-sm"
        />
      ))}
    </div>
  );
}

function extractSurfaceId(msg: A2UIMessage): string | null {
  if ("createSurface" in msg) return msg.createSurface.surfaceId;
  if ("updateComponents" in msg) return msg.updateComponents.surfaceId;
  if ("updateDataModel" in msg) return msg.updateDataModel.surfaceId;
  if ("deleteSurface" in msg) return msg.deleteSurface.surfaceId;
  return null;
}
