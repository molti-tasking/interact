"use client";
import { ComponentWrapper } from "@/components/ComponentWrapper";
import { HiMum } from "interact";

export default function Page() {
  return (
    <ComponentWrapper
      title="PoC Monorepo Component"
      description="First things first. The component below is the first component that is exposed from our package and loaded into this application. It does not have any meaning is just for testing puropses."
      className="mt-8"
    >
      {/* These components require client components. The overall setup of these projects is not perfect yet and the abstraction layer of design and behaviour needs to be found. */}
      <HiMum />
    </ComponentWrapper>
  );
}
