"use client";

import { useStudy } from "@/context/study-context";
import { PartyPopper } from "lucide-react";

export function DoneView() {
  const { state } = useStudy()!;
  return (
    <div className="mx-auto max-w-xl space-y-3 py-16 text-center">
      <PartyPopper className="mx-auto h-10 w-10 text-primary" aria-hidden />
      <h1 className="text-3xl tracking-tight">
        Thank you, {state.participant.display_name}!
      </h1>
      <p className="text-muted-foreground">
        The workshop is complete. You can close this window.
      </p>
    </div>
  );
}
