"use client";
import { ComponentWrapper } from "@/components/ComponentWrapper";
import { AICompletionForm } from "@/components/form/AICompletionForm";
import { AIInteractionForm } from "@/components/form/AIInteractionForm";

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
        description="This example shall showcase an autofilling form based on users input. The user can paste any large texts and the corresponding form fields will be autopopulated."
      >
        <AICompletionForm />
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
