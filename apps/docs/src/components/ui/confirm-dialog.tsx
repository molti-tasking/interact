"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirmation dialog (alert-dialog semantics) built on the Dialog primitive.
 *
 * `onConfirm` may be async: the dialog shows a pending state, cannot be
 * dismissed while it runs, and closes when it resolves. If it throws, the
 * dialog stays open — report the error (e.g. a toast) inside `onConfirm`.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content between the description and the buttons. */
  children?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  pendingLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [pending, setPending] = React.useState(false);

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Caller reports the error; keep the dialog open so they can retry.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
        onPointerDownOutside={(e) => pending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-sans text-base">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={pending || confirmDisabled}
            aria-busy={pending || undefined}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
