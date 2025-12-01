"use client";
import { AIForm } from "@/components/AIForm";
import { ComponentWrapper } from "@/components/ComponentWrapper";

export default function Page() {
  return (
    <ComponentWrapper
      title="AI powered form interactions"
      description="This example shall showcase an interactive form."
      className="mt-8"
    >
      <AIForm
        questionNumber={1}
        currentContribution="Test"
        currentQuestion="Test"
        initialContribution="Test 1"
        initialQuestion="Test 1"
        onUpdate={console.log}
      />
    </ComponentWrapper>
  );
}
