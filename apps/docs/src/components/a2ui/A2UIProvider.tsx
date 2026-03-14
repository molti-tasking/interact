"use client";

import { A2UIProvider as BaseA2UIProvider, standardCatalog } from "@a2ui-sdk/react/0.9";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * Wraps children with the A2UI provider using the standard component catalog.
 * Place at the layout or route level to enable A2UI rendering in descendants.
 */
export function A2UIProviderWrapper({ children }: Props) {
  return (
    <BaseA2UIProvider catalog={standardCatalog}>
      {children}
    </BaseA2UIProvider>
  );
}
