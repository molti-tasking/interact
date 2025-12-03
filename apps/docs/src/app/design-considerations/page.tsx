export default function DesignConsiderationsPage() {
  return (
    <div className="flex items-center justify-center ">
      <main className="flex w-full max-w-3xl flex-col gap-8 text-zinc-600">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="text-3xl font-semibold">
            User Interface Design Considerations
          </h1>
          <p>
            We need to define certain dimensions that are relevant for the
            integration of those components. As of now I think we should provide
            a set of design dimensions for gen ai integration in general in
            order to <strong>support</strong> software engineers integration gen
            ai <strong>responsibly</strong> into their system. Obviously,
            depending on domain, use case, users needs and many other factors we
            might want to integrate different gen ai capabilities into the
            system.
          </p>
        </div>
      </main>
    </div>
  );
}
