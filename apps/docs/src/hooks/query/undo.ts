"use client";

import { useCurrentUser } from "@/context/user-context";
import { type CommitResult, revertCommit } from "@/lib/engine/commit";
import { formatActor } from "@/lib/mock-users";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { applyCommitToCache } from "./portfolios";

/**
 * Returns `notify(result, message, opts?)` — shows a success toast with an
 * "Undo" action that restores the state before `result`, provided nothing
 * else has changed the portfolio since (see `revertCommit`). `onUndone` runs
 * after a successful revert (e.g. to reopen the probe that was answered).
 */
export function useUndoToast() {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);

  return useCallback(
    (
      result: CommitResult | null,
      message: string,
      opts?: { onUndone?: () => void | Promise<void> },
    ) => {
      if (!result) return;
      toast.success(message, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              const reverted = await revertCommit(result, actor, message);
              if (!reverted) {
                toast.error(
                  "Can't undo — the form changed since. Use History to revert.",
                );
                return;
              }
              applyCommitToCache(queryClient, reverted);
              await opts?.onUndone?.();
              toast("Change undone");
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Failed to undo change",
              );
            }
          },
        },
      });
    },
    [queryClient, actor],
  );
}
