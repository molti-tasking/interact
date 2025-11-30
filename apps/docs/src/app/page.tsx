"use client";
import { ComponentWrapper } from "@/components/ComponentWrapper";
import { HiMum } from "interact";

export default function Home() {
  return (
    <div className="flex items-center justify-center ">
      <main className="flex w-full max-w-3xl flex-col items-center justify-between py-32 px-16 sm:items-start">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight  ">
            Interact
          </h1>
          <p className="text-zinc-600">
            This is the start of an open source library aiming to build reusable
            and interactable UI components for gen AI systems. We want to go
            beyond chat.
          </p>
        </div>

        <div className="mt-8">
          <ComponentWrapper
            title="First component"
            description="First things first. The component below is the first component that is exposed from our package and loaded into this application."
          >
            {/* These components require client components. The overall setup of these projects is not perfect yet and the abstraction layer of design and behaviour needs to be found. */}
            <HiMum />
          </ComponentWrapper>
        </div>
      </main>
    </div>
  );
}
