"use client";

import type { A2UIMessage, ComponentDefinition } from "@a2ui-sdk/types/0.9";
import { a2uiComponentsToSerializedSchema } from "@/lib/a2ui-adapter";
import type { SerializedSchema } from "@/lib/schema-manager";
import { useEffect, useRef, useState } from "react";
import type { StreamableValue } from "ai/rsc";
import { readStreamableValue } from "ai/rsc";
import { A2UISurface } from "./A2UISurface";

interface FormPreviewSurfaceProps {
  /** The streamable value from streamFormPreviewAction */
  streamValue: StreamableValue<string> | null;
  /** Called when the stream completes with the final schema + raw A2UI messages */
  onComplete?: (schema: SerializedSchema, messages: A2UIMessage[]) => void;
  /** Fallback to show when not streaming */
  fallback?: React.ReactNode;
}

/**
 * Consumes a JSONL stream of A2UI messages that progressively build a form preview.
 * On completion, converts components to SerializedSchema AND returns raw messages
 * so both formats are available.
 */
export function FormPreviewSurface({
  streamValue,
  onComplete,
  fallback,
}: FormPreviewSurfaceProps) {
  const [messages, setMessages] = useState<A2UIMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const bufferRef = useRef("");
  const metadataRef = useRef<{ name?: string; description?: string }>({});
  const componentsRef = useRef<ComponentDefinition[]>([]);

  useEffect(() => {
    if (!streamValue) return;

    let cancelled = false;
    setIsStreaming(true);
    setMessages([]);
    bufferRef.current = "";
    componentsRef.current = [];
    metadataRef.current = {};

    const collectedMessages: A2UIMessage[] = [];

    (async () => {
      try {
        for await (const chunk of readStreamableValue(streamValue)) {
          if (cancelled) break;
          if (!chunk) continue;

          bufferRef.current += chunk;
          const lines = bufferRef.current.split("\n");
          bufferRef.current = lines.pop() ?? "";

          for (const line of lines) {
            processLine(line, collectedMessages, componentsRef, metadataRef, setMessages);
          }
        }

        // Process remaining buffer
        if (bufferRef.current.trim()) {
          processLine(bufferRef.current, collectedMessages, componentsRef, metadataRef, setMessages);
        }

        // On completion: convert + emit
        if (!cancelled && componentsRef.current.length > 0 && onComplete) {
          const schema = a2uiComponentsToSerializedSchema(
            componentsRef.current,
            metadataRef.current,
          );
          onComplete(schema, collectedMessages);
        }
      } finally {
        if (!cancelled) setIsStreaming(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [streamValue, onComplete]);

  if (!isStreaming && messages.length === 0) {
    if (fallback) return <>{fallback}</>;
    return null;
  }

  return (
    <div className="space-y-2">
      {isStreaming && messages.length === 0 && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Designing form...
        </p>
      )}
      <A2UISurface
        messages={messages}
        surfaceId="form-preview"
        className="rounded-lg"
      />
      {isStreaming && messages.length > 0 && (
        <div className="h-1 bg-primary/20 rounded-full overflow-hidden">
          <div className="h-full bg-primary animate-pulse w-2/3 rounded-full" />
        </div>
      )}
    </div>
  );
}

function processLine(
  raw: string,
  collected: A2UIMessage[],
  componentsRef: React.MutableRefObject<ComponentDefinition[]>,
  metadataRef: React.MutableRefObject<{ name?: string; description?: string }>,
  setMessages: React.Dispatch<React.SetStateAction<A2UIMessage[]>>,
) {
  const trimmed = raw.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed);

    if (parsed.__metadata) {
      metadataRef.current = parsed.__metadata;
      return;
    }

    const msg = parsed as A2UIMessage;

    if ("updateComponents" in msg) {
      for (const comp of msg.updateComponents.components) {
        const idx = componentsRef.current.findIndex((c) => c.id === comp.id);
        if (idx >= 0) {
          componentsRef.current[idx] = comp;
        } else {
          componentsRef.current.push(comp);
        }
      }
    }

    collected.push(msg);
    setMessages((prev) => [...prev, msg]);
  } catch {
    // Skip malformed lines
  }
}
