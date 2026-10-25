"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Something to show about a field in the workspace preview — e.g. the
 * answers it received. A small badge marks the field; the content opens
 * when the field is hovered or focused.
 */
export interface FieldInsight {
  /** Badge text, e.g. "9 answers" */
  label: string;
  content: ReactNode;
}

const FieldInsightsContext = createContext<Readonly<Record<string, FieldInsight>>>({});

/** Field id → insight. Only the workspace preview renders them. */
export function FieldInsightsProvider({
  value,
  children,
}: {
  value: Readonly<Record<string, FieldInsight>>;
  children: ReactNode;
}) {
  return (
    <FieldInsightsContext.Provider value={value}>
      {children}
    </FieldInsightsContext.Provider>
  );
}

export function useFieldInsight(fieldId: string): FieldInsight | undefined {
  return useContext(FieldInsightsContext)[fieldId];
}
