"use client";
import { AIForm } from "@/components/AIForm";
import { ComponentWrapper } from "@/components/ComponentWrapper";
import { HiMum } from "interact";

export default function Page() {
  return (
    <ComponentWrapper
      title="Second component"
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
