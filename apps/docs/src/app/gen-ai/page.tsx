"use client";
import { ComponentWrapper } from "@/components/ComponentWrapper";
import { AICompletionForm } from "@/components/form/AICompletionForm";
import { AIInteractionForm } from "@/components/form/AIInteractionForm";
import { AIVoiceForm } from "@/components/form/AIVoiceForm";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function Page() {
  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          GenAI Form Interactions
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Explore interactive form examples powered by generative AI. These
          components demonstrate how AI can enhance user experience beyond
          traditional chat interfaces.
        </p>
      </div>
      <ComponentWrapper
        title="AI powered form interactions"
        description="This example shall showcase an interactive form."
      >
        <AIInteractionForm
          questionNumber={1}
          currentContribution="Test"
          currentQuestion="Test"
          initialContribution="Test 1"
          initialQuestion="Test 1"
          onUpdate={console.log}
        />
      </ComponentWrapper>

      <ComponentWrapper
        title="AI powered form completion or validation"
        description={
          <div>
            This example shall showcase an autofilling form based on users
            input. The user can paste any large texts and the corresponding form
            fields will be autopopulated. This component is powered by the
            popular form libraries{" "}
            <Link
              className="text-blue-800"
              target="_blank"
              href={"https://zod.dev/"}
            >
              zod <ArrowUpRight className="inline size-3 -mt-2" />
            </Link>{" "}
            and{" "}
            <Link
              className="text-blue-800"
              target="_blank"
              href={"https://react-hook-form.com/"}
            >
              react-hook-form
              <ArrowUpRight className="inline size-3 -mt-2" />
            </Link>{" "}
            of the react ecosystem. It shall leverage their available utilities
            and ease the integration of advanced ai feature into existing
            applications.
          </div>
        }
      >
        <AICompletionForm />
      </ComponentWrapper>

      <ComponentWrapper
        title="AI powered Vocie form"
        description="Form integrates with voice interaction with minimal code efforts. Just pass your zod schema and form hook to the component and it should handle the rest. As of now we just simulate delayed inputs and we only accept input fields of type 'string'."
      >
        <AIVoiceForm />
      </ComponentWrapper>
      <ComponentWrapper
        title="AI powered dynamic form completion"
        description="This example shall showcase an autofilling form based on users input for a dynamic form. The user can define certain depending form fields and the gen AI returns a more or less valid schema for that form component. It uses the zod schema and input texts to generate the values for the fields. After that we might also want to highlight the changes accordingly: We will have 'New content' or even 'Updated content' and the question is also on how to store that information and how to visualize it."
      >
        <div className="text-center py-12 text-muted-foreground">
          Coming soon...
        </div>
      </ComponentWrapper>
    </div>
  );
}
