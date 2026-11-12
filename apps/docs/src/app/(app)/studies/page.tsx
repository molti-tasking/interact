"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateStudySession, useStudySessions } from "@/hooks/query/study";
import { BRIEF_KEYS } from "@/lib/study/briefs";
import {
  DEFAULT_PHASE_DURATIONS,
  DEFAULT_STUDY_SETTINGS,
  PHASE_COPY,
  type PhaseDurations,
  type StudyMode,
  type StudySettings,
} from "@/lib/study/types";
import { ChevronRight, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SessionSettingsFields } from "./_components/session-settings";

/**
 * Workshop sessions (study mode): participants join with a code, the
 * facilitator moves the room through create → answer → review → reflect.
 */
export default function StudiesPage() {
  const sessions = useStudySessions();
  const create = useCreateStudySession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [durations, setDurations] = useState<PhaseDurations>(DEFAULT_PHASE_DURATIONS);
  const [settings, setSettings] = useState<StudySettings>(DEFAULT_STUDY_SETTINGS);

  const setMode = (mode: StudyMode) =>
    setSettings(
      mode === "briefs"
        ? {
            ...DEFAULT_STUDY_SETTINGS,
            mode,
            briefs: BRIEF_KEYS,
            // The wave-1 comparison; the silent baseline and the ablation
            // can be ticked as extra arms
            conditions: ["full", "assistant"],
            contact: settings.contact,
          }
        : { ...DEFAULT_STUDY_SETTINGS, contact: settings.contact },
    );

  const handleCreate = () => {
    if (!name.trim() || create.isPending) return;
    create.mutate(
      { name: name.trim(), phaseDurations: durations, settings },
      {
        onSuccess: (session) => router.push(`/studies/${session.id}`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl tracking-tight text-primary">Studies</h1>
        <p className="text-muted-foreground">
          A workshop in a room (participants join with a code and you move
          everyone through the phases), or a self-paced online study with
          fixed situations for a panel such as Prolific.
        </p>
      </div>

      <section aria-labelledby="sessions-heading" className="space-y-3">
        <h2 id="sessions-heading" className="text-lg font-medium">Sessions</h2>
        {sessions.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : sessions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {sessions.error.message}
          </p>
        ) : (sessions.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {sessions.data!.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/studies/${session.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{session.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(session.created_at).toLocaleString()}
                    </span>
                  </span>
                  <span className="font-mono text-sm tracking-widest">{session.join_code}</span>
                  <Badge variant={session.phase === "done" ? "outline" : "secondary"}>
                    {session.settings.mode === "briefs"
                      ? session.phase === "create"
                        ? "Online · open"
                        : session.phase === "done"
                          ? "Online · closed"
                          : "Online · not open"
                      : PHASE_COPY[session.phase].label}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="p-4 sm:p-6">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
        >
          <h2 className="text-lg font-medium">New session</h2>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kind</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of session">
              {(
                [
                  ["workshop", "Workshop in a room"],
                  ["briefs", "Online study (self-paced)"],
                ] as const
              ).map(([mode, label]) => (
                <Button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={settings.mode === mode}
                  variant={settings.mode === mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode(mode)}
                  disabled={create.isPending}
                  data-testid={`mode-${mode}`}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="session-name">Name</Label>
            <Input
              id="session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hobby workshop · 12 Nov"
              maxLength={80}
              disabled={create.isPending}
            />
          </div>
          <SessionSettingsFields
            durations={durations}
            onDurationsChange={setDurations}
            settings={settings}
            onSettingsChange={setSettings}
            disabled={create.isPending}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Create session
          </Button>
        </form>
      </Card>
    </div>
  );
}
