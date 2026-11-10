"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useJoinStudy,
  useMySeats,
  usePanelJoin,
  useSessionUser,
  useSignOut,
} from "@/hooks/query/study";
import { PHASE_COPY, panelParams } from "@/lib/study/types";
import { ArrowRight, Loader2, LogOut, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/**
 * Workshop entry: code + display name. The browser is signed in
 * anonymously; the seat (and the participant's form) stays with it, so a
 * reload or re-join continues where the participant left off.
 */
export default function JoinPage() {
  return (
    <Suspense>
      <JoinContent />
    </Suspense>
  );
}

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(
    () => searchParams.get("code")?.toUpperCase() ?? "",
  );
  const [name, setName] = useState("");
  const { data: user, isLoading: userLoading } = useSessionUser();
  const seats = useMySeats(user?.isAnonymous ? user.id : undefined);
  const join = useJoinStudy();
  const signOut = useSignOut();

  const openSeats = (seats.data ?? []).filter((s) => s.phase !== "done");
  const isFacilitator = !!user && !user.isAnonymous;
  const panel = panelParams(searchParams);

  // Panel link (Prolific): join straight away, no name to type
  if (panel && code && !userLoading && !isFacilitator) {
    return <PanelJoin code={code} panel={panel} />;
  }
  const canSubmit = code.trim().length > 0 && name.trim().length > 0 && !join.isPending;

  const handleJoin = () => {
    if (!canSubmit) return;
    join.mutate(
      { code: code.trim(), displayName: name.trim() },
      { onSuccess: ({ sessionId }) => router.push(`/study/${sessionId}`) },
    );
  };

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Users className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <h1 className="text-3xl tracking-tight">Join the workshop</h1>
          <p className="text-muted-foreground">
            Enter the code shown by the facilitator and a name the others will
            see.
          </p>
        </div>

        {isFacilitator && (
          <Card className="space-y-3 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <p>
              This browser is signed in with a facilitator account. Joining
              here would sign you out of it.
            </p>
            <p className="text-muted-foreground">
              To try the participant view, use a private window or another
              browser profile.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Sign out to join
            </Button>
          </Card>
        )}

        {openSeats.length > 0 && (
          <Card className="space-y-2 p-4">
            <p className="text-sm font-medium">Continue where you left off</p>
            {openSeats.map((seat) => (
              <Button
                key={seat.participantId}
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push(`/study/${seat.sessionId}`)}
              >
                <span className="truncate">
                  {seat.sessionName} · {seat.displayName}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {PHASE_COPY[seat.phase].label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </Button>
            ))}
          </Card>
        )}

        {!isFacilitator && (
          <Card className="p-4 sm:p-6">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleJoin();
              }}
              aria-busy={join.isPending || undefined}
            >
              <div className="space-y-2">
                <Label htmlFor="join-code">Session code</Label>
                <Input
                  id="join-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. K7Q2MX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={12}
                  className="font-mono text-lg tracking-widest"
                  disabled={join.isPending || userLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-name">Your name</Label>
                <Input
                  id="join-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First name or a nickname"
                  autoComplete="nickname"
                  maxLength={40}
                  disabled={join.isPending || userLoading}
                  aria-describedby="join-name-hint"
                />
                <p id="join-name-hint" className="text-xs text-muted-foreground">
                  Shown to the other participants next to your form.
                </p>
              </div>
              {join.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {join.error.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {join.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                )}
                Join
              </Button>
            </form>
          </Card>
        )}
      </div>
    </main>
  );
}

/**
 * Joining from a panel link: signs in anonymously and takes (or resumes)
 * the participant's seat, then opens the session. Retries on demand.
 */
function PanelJoin({
  code,
  panel,
}: {
  code: string;
  panel: NonNullable<ReturnType<typeof panelParams>>;
}) {
  const router = useRouter();
  const join = usePanelJoin({ code, ...panel });

  const joinedSessionId = join.data?.sessionId;
  useEffect(() => {
    if (joinedSessionId) router.replace(`/study/${joinedSessionId}`);
  }, [joinedSessionId, router]);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md space-y-4 p-6 text-center">
        {join.isError ? (
          <>
            <h1 className="text-xl tracking-tight">Couldn&apos;t start the study</h1>
            <p role="alert" className="text-sm text-destructive">
              {join.error.message}
            </p>
            <Button onClick={() => void join.refetch()} disabled={join.isFetching}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Loader2
              className="mx-auto h-6 w-6 animate-spin text-primary"
              aria-hidden
            />
            <p className="text-muted-foreground" role="status">
              Starting the study…
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
