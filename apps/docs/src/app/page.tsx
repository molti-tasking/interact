"use client";

export default function Home() {
  return (
    <div className="flex items-center justify-center ">
      <main className="flex w-full max-w-3xl flex-col gap-8 text-zinc-600">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="text-3xl font-semibold">Interact</h1>
          <p>
            This is the start of an open source library aiming to build reusable
            and interactable UI components for gen AI systems. We want to go
            beyond chat.
          </p>
          <p>Checkout the components on the side menu.</p>
        </div>

        <div className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">
            What do we actually want from this repository?
          </h2>
          <p>
            There is a ton of generative AI components out there - most of them
            are around chats and promise the benefits of agentic workflows.
          </p>
          <p>
            In reality, there are sophisticated systems operating our global
            world for a long time before we even knew of generative AI.
            Therefore, we strive to build components that can empower ai
            agnostic systems. We believe a good system should not depend on
            generative ai and it should just work even without any ai.
            Nevertheless, we want to empower system builders to implement
            thoughtful ai interactions into their systems that are opinionated.
          </p>
        </div>
      </main>
    </div>
  );
}
