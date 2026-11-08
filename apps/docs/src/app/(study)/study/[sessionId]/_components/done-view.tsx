"use client";

import { Button } from "@/components/ui/button";
import { useStudy } from "@/context/study-context";
import { ExternalLink, PartyPopper } from "lucide-react";
import { safeCompletionUrl } from "@/lib/study/types";
import { useEffect } from "react";

/** Seconds before a panel participant is sent back to the panel. */
const RETURN_DELAY_MS = 5_000;

export function DoneView() {
  const { state, log } = useStudy()!;
  // Panel participants (Prolific) go back through the completion link, which
  // is how the panel records the submission as complete. The server sends
  // it only to them, and only now.
  const returnUrl = safeCompletionUrl(state.completion_url);

  useEffect(() => {
    if (!returnUrl) return;
    const t = setTimeout(() => {
      log("completion_redirect", { automatic: true });
      window.location.assign(returnUrl);
    }, RETURN_DELAY_MS);
    return () => clearTimeout(t);
  }, [returnUrl, log]);

  return (
    <div className="mx-auto max-w-xl space-y-3 py-16 text-center">
      <PartyPopper className="mx-auto h-10 w-10 text-primary" aria-hidden />
      <h1 className="text-3xl tracking-tight">
        Thank you, {state.participant.display_name}!
      </h1>
      {returnUrl ? (
        <>
          <p className="text-muted-foreground">
            The study is complete. Taking you back to Prolific to confirm your
            submission…
          </p>
          <Button asChild>
            <a
              href={returnUrl}
              onClick={() => log("completion_redirect", { automatic: false })}
            >
              Return to Prolific now
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground">
          The workshop is complete. You can close this window.
        </p>
      )}
    </div>
  );
}
