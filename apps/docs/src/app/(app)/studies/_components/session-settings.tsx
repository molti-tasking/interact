"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PHASE_COPY,
  type PhaseDurations,
  type StudySettings,
} from "@/lib/study/types";

const TIMED_PHASES = ["create", "answer", "review", "questionnaire"] as const;

/** Planned minutes per phase + voice + threshold for probes from answers. */
export function SessionSettingsFields({
  durations,
  onDurationsChange,
  settings,
  onSettingsChange,
  disabled,
}: {
  durations: PhaseDurations;
  onDurationsChange: (next: PhaseDurations) => void;
  settings: StudySettings;
  onSettingsChange: (next: StudySettings) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Planned minutes per phase</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIMED_PHASES.map((phase) => (
            <div key={phase} className="space-y-1">
              <Label htmlFor={`duration-${phase}`} className="text-xs text-muted-foreground">
                {PHASE_COPY[phase].label}
              </Label>
              <Input
                id={`duration-${phase}`}
                type="number"
                min={0}
                max={240}
                value={Math.round((durations[phase] ?? 0) / 60)}
                onChange={(e) =>
                  onDurationsChange({
                    ...durations,
                    [phase]: Math.max(0, Number(e.target.value) || 0) * 60,
                  })
                }
                disabled={disabled}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A soft countdown for everyone; you move the room on. 0 = no timer.
        </p>
      </fieldset>

      <div className="flex items-start gap-2">
        <Checkbox
          id="allow-voice"
          checked={settings.allowVoice}
          onCheckedChange={(checked) =>
            onSettingsChange({ ...settings, allowVoice: checked === true })
          }
          disabled={disabled}
        />
        <div className="space-y-0.5">
          <Label htmlFor="allow-voice">Allow voice input</Label>
          <p className="text-xs text-muted-foreground">
            Dictation and “Talk” in the design workspace. Off in a shared room
            unless participants have headsets.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="findings-min">Design questions from answers after</Label>
        <div className="flex items-center gap-2">
          <Input
            id="findings-min"
            type="number"
            min={1}
            max={50}
            className="w-20"
            value={settings.findingsMinResponses}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                findingsMinResponses: Math.max(1, Number(e.target.value) || 1),
              })
            }
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">answers per form</span>
        </div>
        <p className="text-xs text-muted-foreground">
          In Refine, patterns in the answers (an option nobody picks, a question
          everyone answers the same way) become design questions. The app default is 20.
        </p>
      </div>

    </div>
  );
}
