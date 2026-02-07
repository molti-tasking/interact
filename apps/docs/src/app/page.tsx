"use client";

export default function Home() {
  return (
    <div className="flex items-center justify-center ">
      <main className="flex w-full flex-col gap-8 ">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="text-3xl font-semibold">Interact</h1>
          <p>
            This is the start of an open source library aiming to build reusable
            and interactable UI components for gen AI systems. We want to go
            beyond chat.
          </p>
          <p>
            This overall project is proud to be non-vibecoded. Checkout the
            components on the side menu.
          </p>
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

        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h2 className="text-2xl font-semibold">Think about the Motivation</h2>
          <p className="font-black">
            What is a very impossible goal that we can somehow solve?
          </p>
          <p>
            Option A: In companies we may have very many different deparments or
            needs and then there are high paid intermediary managers in charge
            of understanding all their problems, needs and businesses in order
            to come up with a standardized solution aiming to cover all of them.
            This process takes time and normally the different departments are a
            little bit unhappy with the solution.
          </p>
          <p className="font-black">
            Regarding the malleable forms? What is the malleable intent? Who
            decides for changes?
          </p>
          <p>
            Maybe the form creator can decide what to allow for changes or
            something like that...
          </p>
          <p className="font-black">What about the end user programmability?</p>
          <p>...</p>
          <p className="font-black">How can we demo this project?</p>
          <p>
            Maybe we can voice record and transcribe a meeting taking notes
            automatically into a form? Listening to a meeting in the team and
            let it create a list of all the projects we are working on.
          </p>
        </div>
      </main>
    </div>
  );
}
