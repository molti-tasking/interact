"use client";
import { createContext, PropsWithChildren, useContext } from "react";
import { InlineEditorReturnType } from "./useInlineEditor";

const DirectEditContext = createContext<InlineEditorReturnType | undefined>(
  undefined
);

export const DirectEditProvider = ({
  children,
  ...context
}: PropsWithChildren<InlineEditorReturnType>) => {
  return (
    <DirectEditContext.Provider value={context}>
      {children}
    </DirectEditContext.Provider>
  );
};

export function useDirectEditContext() {
  const context = useContext(DirectEditContext);
  if (!context) {
    throw new Error("useDirectEdit must be used within a DirectEditProvider");
  }
  return context;
}
