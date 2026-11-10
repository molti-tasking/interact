"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCompletionUrl,
  useSaveCompletionUrl,
  useUpdateStudySession,
} from "@/hooks/query/study";
import {
  safeCompletionUrl,
  type PhaseDurations,
  type StudySession,
  type StudySettings,
} from "@/lib/study/types";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SessionSettingsFields } from "../../_components/session-settings";

export function SettingsCard({ session }: { session: StudySession }) {
  const update = useUpdateStudySession();
  const [durations, setDurations] = useState<PhaseDurations>(session.phase_durations);
  const [settings, setSettings] = useState<StudySettings>(session.settings);
  const dirty =
    JSON.stringify(durations) !== JSON.stringify(session.phase_durations) ||
    JSON.stringify(settings) !== JSON.stringify(session.settings);

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="text-lg font-medium">Settings</h2>
      <SessionSettingsFields
        durations={durations}
        onDurationsChange={setDurations}
        settings={settings}
        onSettingsChange={setSettings}
        disabled={update.isPending}
      />
      <p className="text-xs text-muted-foreground">
        {session.settings.mode === "briefs"
          ? "Changes reach participants within seconds. Situations and conditions should stay as they are once people have started."
          : "New durations apply from the next phase. Voice and suggestions update on participants’ screens within seconds."}
      </p>
      <Button
        disabled={!dirty || update.isPending}
        onClick={() =>
          update.mutate(
            { id: session.id, settings, phaseDurations: durations },
            {
              onSuccess: () => toast.success("Settings saved"),
              onError: (err) => toast.error(err.message),
            },
          )
        }
      >
        {update.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Save settings
      </Button>
      <CompletionUrlField sessionId={session.id} />
    </Card>
  );
}

/**
 * Where panel participants go at the end (e.g. Prolific's completion URL).
 * Stored apart from the settings: it carries the completion code, which
 * participants must not see before they're done.
 */
function CompletionUrlField({ sessionId }: { sessionId: string }) {
  const stored = useCompletionUrl(sessionId);
  const save = useSaveCompletionUrl(sessionId);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? stored.data ?? "";
  const trimmed = value.trim();
  const valid = trimmed === "" || safeCompletionUrl(trimmed) !== null;
  const dirty = draft !== null && trimmed !== (stored.data ?? "");

  return (
    <div className="space-y-1 border-t pt-4">
      <Label htmlFor="completion-url">Completion URL (Prolific)</Label>
      <div className="flex gap-2">
        <Input
          id="completion-url"
          type="url"
          placeholder="https://app.prolific.com/submissions/complete?cc=…"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={!valid || undefined}
          disabled={stored.isLoading || save.isPending}
        />
        <Button
          variant="outline"
          disabled={!dirty || !valid || save.isPending}
          onClick={() =>
            save.mutate(trimmed || null, {
              onSuccess: () => {
                setDraft(null);
                toast.success("Completion URL saved");
              },
              onError: (err) => toast.error(err.message),
            })
          }
        >
          Save
        </Button>
      </div>
      <p className={valid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
        {valid
          ? "Participants from a Prolific link are sent here when they have finished (in a workshop: when the session is done). Only they see it, and only then."
          : "Enter a full https:// link."}
      </p>
    </div>
  );
}
