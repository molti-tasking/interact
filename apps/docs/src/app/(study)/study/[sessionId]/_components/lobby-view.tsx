"use client";

import { Card } from "@/components/ui/card";
import { useStudy } from "@/context/study-context";
import { ClipboardList, MessageSquareText, PencilRuler, Users } from "lucide-react";

const STEPS = [
  {
    icon: PencilRuler,
    title: "Create",
    text: "Design a form about your hobby with the tool — something you would genuinely like to ask other people.",
  },
  {
    icon: ClipboardList,
    title: "Answer",
    text: "Fill in the forms of everyone else in the room, as yourself.",
  },
  {
    icon: MessageSquareText,
    title: "Review & refine",
    text: "Read the answers to your form. Did you get what you needed, in a useful shape? Improve the form.",
  },
];

/** Before the facilitator starts: who's here and what's coming. */
export function LobbyView() {
  const { state } = useStudy()!;
  const { participant, participant_count: count } = state;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl tracking-tight">
          Welcome, {participant.display_name}!
        </h1>
        <p className="flex items-center justify-center gap-1.5 text-muted-foreground">
          <Users className="h-4 w-4" aria-hidden />
          {count} {count === 1 ? "person has" : "people have"} joined. The
          facilitator will start the workshop shortly.
        </p>
      </div>

      <Card className="divide-y p-0">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <div key={title} className="flex gap-4 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="font-medium">
                {i + 1}. {title}
              </p>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          </div>
        ))}
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        While you wait: which hobby will your form be about, and what would
        you like to find out from the others?
      </p>
    </div>
  );
}
