"use client";

import {
  A2UIProvider,
  A2UIRenderer,
  useA2UIMessageHandler,
  standardCatalog,
} from "@a2ui-sdk/react/0.9";
import type { A2UIMessage, A2UIAction } from "@a2ui-sdk/react/0.9";
import { useEffect, useRef } from "react";

interface A2UISurfaceProps {
  /** Initial messages to render (processed once on mount or when array ref changes) */
  messages: A2UIMessage[];
  /** Optional surface ID to render a specific surface */
  surfaceId?: string;
  /** Callback when a button action is dispatched */
  onAction?: (action: A2UIAction) => void;
  /** Additional CSS class */
  className?: string;
}

/**
 * Inner component that uses the message handler hook (must be inside A2UIProvider).
 */
function A2UISurfaceInner({
  messages,
  surfaceId,
  onAction,
}: Omit<A2UISurfaceProps, "className">) {
  const { processMessages, clear } = useA2UIMessageHandler();
  const prevMessagesRef = useRef<A2UIMessage[]>([]);

  useEffect(() => {
    // Only reprocess if messages array actually changed
    if (messages !== prevMessagesRef.current) {
      clear();
      if (messages.length > 0) {
        processMessages(messages);
      }
      prevMessagesRef.current = messages;
    }
  }, [messages, processMessages, clear]);

  return <A2UIRenderer surfaceId={surfaceId} onAction={onAction} />;
}

/**
 * Reusable component that takes A2UI messages, processes them, and renders via A2UIRenderer.
 * Each instance creates its own A2UIProvider scope so multiple surfaces can coexist.
 */
export function A2UISurface({
  messages,
  surfaceId,
  onAction,
  className,
}: A2UISurfaceProps) {
  return (
    <div className={className}>
      <A2UIProvider catalog={standardCatalog}>
        <A2UISurfaceInner
          messages={messages}
          surfaceId={surfaceId}
          onAction={onAction}
        />
      </A2UIProvider>
    </div>
  );
}

/**
 * Streaming variant that accepts messages incrementally.
 * Use the returned processMessage callback to feed messages one at a time.
 */
interface StreamingA2UISurfaceProps {
  surfaceId?: string;
  onAction?: (action: A2UIAction) => void;
  className?: string;
  children?: (handler: {
    processMessage: (msg: A2UIMessage) => void;
    clear: () => void;
  }) => React.ReactNode;
}

function StreamingInner({
  surfaceId,
  onAction,
  children,
}: Omit<StreamingA2UISurfaceProps, "className">) {
  const handler = useA2UIMessageHandler();

  return (
    <>
      {children?.(handler)}
      <A2UIRenderer surfaceId={surfaceId} onAction={onAction} />
    </>
  );
}

export function StreamingA2UISurface({
  surfaceId,
  onAction,
  className,
  children,
}: StreamingA2UISurfaceProps) {
  return (
    <div className={className}>
      <A2UIProvider catalog={standardCatalog}>
        <StreamingInner
          surfaceId={surfaceId}
          onAction={onAction}
          children={children}
        />
      </A2UIProvider>
    </div>
  );
}
