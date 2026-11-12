/**
 * E1's frozen material: per scenario an intent, a base form generated once,
 * seeded responses, and a script of change requests with their gold specs.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { PortfolioSchema, SectionKey, StructuredIntent } from "@/lib/types";

export const SCENARIOS_DIR = path.join(__dirname, "scenarios");
export const SCENARIOS = ["soccer", "sales", "orthopedic"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

/** Intents carry a fixed time, so every run starts from identical bytes. */
export const MATERIAL_TIME = "2026-11-12T00:00:00.000Z";

const SECTION_HEADINGS: Record<string, SectionKey> = {
  purpose: "purpose",
  audience: "audience",
  exclusions: "exclusions",
  constraints: "constraints",
};

export interface IntentFile {
  title: string;
  source: string;
  intent: StructuredIntent;
}

/** `intent.md`: YAML front matter, then `## Purpose` / `## Audience` / … sections. */
export function parseIntentFile(text: string): IntentFile {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("intent.md needs YAML front matter");
  const meta = parse(match[1]) as { title?: string; source?: string };
  const intent: StructuredIntent = {
    purpose: { content: "", updatedAt: MATERIAL_TIME },
    audience: { content: "", updatedAt: MATERIAL_TIME },
    exclusions: { content: "", updatedAt: MATERIAL_TIME },
    constraints: { content: "", updatedAt: MATERIAL_TIME },
  };
  let current: SectionKey | null = null;
  const lines: Record<SectionKey, string[]> = { purpose: [], audience: [], exclusions: [], constraints: [] };
  for (const line of match[2].split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const key = SECTION_HEADINGS[heading[1].toLowerCase()];
      if (!key) throw new Error(`Unknown intent section "${heading[1]}"`);
      current = key;
      continue;
    }
    if (current) lines[current].push(line);
  }
  for (const key of Object.keys(lines) as SectionKey[]) {
    intent[key] = { content: lines[key].join("\n").trim(), updatedAt: MATERIAL_TIME };
  }
  if (!intent.purpose.content) throw new Error("intent.md has no purpose");
  return { title: meta.title ?? "", source: meta.source ?? "", intent };
}

export function scenarioDir(name: ScenarioName): string {
  return path.join(SCENARIOS_DIR, name);
}

export function loadIntent(name: ScenarioName): IntentFile {
  return parseIntentFile(fs.readFileSync(path.join(scenarioDir(name), "intent.md"), "utf-8"));
}

export function loadBaseSchema(name: ScenarioName): PortfolioSchema {
  return JSON.parse(fs.readFileSync(path.join(scenarioDir(name), "base-schema.json"), "utf-8"));
}
