"use client";

import type { A2UIMessage } from "@a2ui-sdk/types/0.9";
import {
  serializedSchemaToA2UIMessages,
  formValuesToDataModelMessages,
} from "@/lib/a2ui-adapter";
import type { SerializedSchema } from "@/lib/schema-manager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { A2UISurface } from "./A2UISurface";

interface A2UIFormFillerProps {
  /** The schema to render as an A2UI form */
  schema: SerializedSchema;
  /** Values to progressively fill into the form */
  fillValues?: Record<string, unknown> | null;
  /** Delay in ms between filling each field (progressive animation) */
  fieldDelay?: number;
  /** Called when all fields have been filled */
  onFillComplete?: () => void;
  /** CSS class */
  className?: string;
}

/**
 * Renders a SerializedSchema as an A2UI surface and optionally
 * animates progressive field filling via updateDataModel messages.
 * Replaces the useFormFilling hook's custom animation logic.
 */
export function A2UIFormFiller({
  schema,
  fillValues,
  fieldDelay = 600,
  onFillComplete,
  className,
}: A2UIFormFillerProps) {
  // Convert schema to A2UI messages (memoized)
  const baseMessages = useMemo(
    () => serializedSchemaToA2UIMessages(schema, "a2ui-form"),
    [schema],
  );

  // Track all messages including progressive fill updates
  const [allMessages, setAllMessages] = useState<A2UIMessage[]>(baseMessages);
  const fillTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isMountedRef = useRef(true);

  // Reset messages when schema changes
  useEffect(() => {
    setAllMessages(baseMessages);
  }, [baseMessages]);

  // Progressive fill animation
  useEffect(() => {
    if (!fillValues || Object.keys(fillValues).length === 0) return;

    const dataMessages = formValuesToDataModelMessages(fillValues, "a2ui-form");
    let currentIndex = 0;

    const fillNext = () => {
      if (!isMountedRef.current || currentIndex >= dataMessages.length) {
        if (isMountedRef.current) onFillComplete?.();
        return;
      }

      const msg = dataMessages[currentIndex];
      setAllMessages((prev) => [...prev, msg]);
      currentIndex++;

      fillTimerRef.current = setTimeout(fillNext, fieldDelay);
    };

    // Start filling after a short delay
    fillTimerRef.current = setTimeout(fillNext, fieldDelay);

    return () => {
      if (fillTimerRef.current) clearTimeout(fillTimerRef.current);
    };
  }, [fillValues, fieldDelay, onFillComplete]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return (
    <A2UISurface
      messages={allMessages}
      surfaceId="a2ui-form"
      className={className}
    />
  );
}
