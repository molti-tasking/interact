"use client";

import type { PortfolioSchema } from "@/lib/types";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * State shared between the design probe deck and the form canvas:
 * - the answer or fix being previewed (hovered in the deck, shown on the form),
 * - the conflicts to mark on the form, and which one is open,
 * - which deck card is open (the canvas can open a conflict's card).
 */

/** A design probe answer or conflict fix being previewed (not yet applied). */
export interface ProbePreview {
  /** The probe or conflict the option belongs to */
  ownerId: string;
  optionValue: string;
  label: string;
  summary: string;
  /** The schema with this option applied */
  apply: (schema: PortfolioSchema) => PortfolioSchema;
}

interface ProbePreviewActions {
  show: (preview: ProbePreview) => void;
  /** Stop previewing this option (after a short delay, so moving between options doesn't flicker). */
  hide: (ownerId: string, optionValue: string) => void;
  /** Stop previewing right away. */
  clear: () => void;
}

export interface ConflictMark {
  id: string;
  severity: "error" | "warning" | "info";
  label: string;
  description: string;
  fieldIds: string[];
}

interface ConflictMarks {
  marks: ConflictMark[];
  /** The conflict whose card is open in the deck */
  activeId: string | null;
}

const NO_MARKS: ConflictMarks = { marks: [], activeId: null };

// Split so components only re-render for the state they read (the deck
// sets the preview but must not re-render on every hover).
const PreviewContext = createContext<ProbePreview | null>(null);
const ActionsContext = createContext<ProbePreviewActions>({
  show: () => {},
  hide: () => {},
  clear: () => {},
});
const MarksContext = createContext<ConflictMarks>(NO_MARKS);
const SetMarksContext = createContext<(marks: ConflictMarks) => void>(
  () => {},
);
const FocusContext = createContext<
  readonly [string | null, (id: string | null) => void]
>([null, () => {}]);

const HIDE_DELAY_MS = 80;

export function DeckCanvasProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preview, setPreview] = useState<ProbePreview | null>(null);
  // Mirrors `preview` for the callbacks, which must stay stable
  const current = useRef<ProbePreview | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [marks, setMarks] = useState<ConflictMarks>(NO_MARKS);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focus = useMemo(() => [focusedId, setFocusedId] as const, [focusedId]);

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const update = (next: ProbePreview | null) => {
    current.current = next;
    setPreview(next);
  };

  const show = useCallback((next: ProbePreview) => {
    cancelHide();
    update(next);
  }, []);

  const hide = useCallback((ownerId: string, optionValue: string) => {
    const shown = current.current;
    // Only the option being previewed can end the preview — otherwise
    // another option unmounting would cancel its pending hide.
    if (shown?.ownerId !== ownerId || shown.optionValue !== optionValue) {
      return;
    }
    cancelHide();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      if (current.current === shown) update(null);
    }, HIDE_DELAY_MS);
  }, []);

  const clear = useCallback(() => {
    cancelHide();
    update(null);
  }, []);

  const actions = useMemo(() => ({ show, hide, clear }), [show, hide, clear]);

  return (
    <ActionsContext.Provider value={actions}>
      <PreviewContext.Provider value={preview}>
        <SetMarksContext.Provider value={setMarks}>
          <MarksContext.Provider value={marks}>
            <FocusContext.Provider value={focus}>{children}</FocusContext.Provider>
          </MarksContext.Provider>
        </SetMarksContext.Provider>
      </PreviewContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useProbePreview(): ProbePreview | null {
  return useContext(PreviewContext);
}

export function useProbePreviewActions(): ProbePreviewActions {
  return useContext(ActionsContext);
}

export function useConflictMarks(): ConflictMarks {
  return useContext(MarksContext);
}

export function useSetConflictMarks(): (marks: ConflictMarks) => void {
  return useContext(SetMarksContext);
}

/** The deck card the user opened (null: the deck picks the most important). */
export function useDeckFocus() {
  return useContext(FocusContext);
}
