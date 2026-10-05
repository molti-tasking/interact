import { describe, expect, it } from "vitest";
import { createOrderedDelivery } from "@/lib/voice/ordered-delivery";

describe("ordered delivery", () => {
  it("delivers results in reservation order even when they settle out of order", () => {
    const out: string[] = [];
    const d = createOrderedDelivery<string>((v) => out.push(v));
    const a = d.reserve();
    const b = d.reserve();
    const c = d.reserve();
    d.resolve(c, "third");
    d.resolve(b, "second");
    expect(out).toEqual([]);
    d.resolve(a, "first");
    expect(out).toEqual(["first", "second", "third"]);
    expect(d.pending).toBe(0);
  });

  it("does not let a skipped position hold up later ones", () => {
    const out: string[] = [];
    const d = createOrderedDelivery<string>((v) => out.push(v));
    const a = d.reserve();
    const b = d.reserve();
    d.resolve(b, "b");
    d.skip(a);
    expect(out).toEqual(["b"]);
  });

  it("ignores late or duplicate settlements", () => {
    const out: string[] = [];
    const d = createOrderedDelivery<string>((v) => out.push(v));
    const a = d.reserve();
    d.skip(a);
    d.resolve(a, "late");
    const b = d.reserve();
    d.resolve(b, "b");
    d.resolve(b, "again");
    expect(out).toEqual(["b"]);
  });
});
