"use client";

import { syncIntentAfterSchemaEdit } from "@/app/actions/intent-sync-actions";
import { logProvenance } from "@/lib/engine/provenance";
import { createClient } from "@/lib/supabase/client";
import type { PortfolioSchema } from "@/lib/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Hook to synchronize intent after a direct schema edit.
 * Fire-and-forget mutation that updates intent based on field changes.
 */
export function useSyncIntent(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      currentIntent,
      editDescription,
      currentSchema,
    }: {
      currentIntent: string;
      editDescription: string;
      currentSchema: PortfolioSchema;
    }) => {
      const response = await syncIntentAfterSchemaEdit(
        currentIntent,
        editDescription,
        currentSchema,
      );

      if (!response.success || !response.updatedIntent) {
        throw new Error(response.error ?? "Failed to sync intent");
      }

      // Update portfolio intent in DB
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("portfolios")
        .update({
          intent: response.updatedIntent,
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolioId);

      if (updateError) throw updateError;

      // Log provenance entry for intent backpropagation
      await logProvenance(
        portfolioId,
        "intent",
        "intent_backpropagated",
        "system",
        { added: [], removed: [], modified: [] },
        editDescription,
        { intent: currentIntent, schema: currentSchema },
      );

      return {
        updatedIntent: response.updatedIntent,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portfolios", portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ["provenance", portfolioId],
      });
    },
  });
}
