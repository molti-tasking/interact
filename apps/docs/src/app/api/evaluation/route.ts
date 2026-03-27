import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

const RESULTS_DIR = path.resolve(process.cwd(), "tests/evaluation/results");

/** Dimension metadata for the UI (avoids importing from test code). */
const CDN_DIMENSIONS = [
  { id: "viscosity", name: "Viscosity", lowerIsBetter: true },
  {
    id: "premature-commitment",
    name: "Premature Commitment",
    lowerIsBetter: true,
  },
  {
    id: "progressive-evaluation",
    name: "Progressive Evaluation",
    lowerIsBetter: false,
  },
  {
    id: "hidden-dependencies",
    name: "Hidden Dependencies",
    lowerIsBetter: true,
  },
  { id: "visibility", name: "Visibility", lowerIsBetter: false },
  {
    id: "closeness-of-mapping",
    name: "Closeness of Mapping",
    lowerIsBetter: false,
  },
  {
    id: "role-expressiveness",
    name: "Role-Expressiveness",
    lowerIsBetter: false,
  },
  { id: "provisionality", name: "Provisionality", lowerIsBetter: false },
];

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function getRunDirs(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter(
      (d) =>
        d.startsWith("run-") &&
        fs.statSync(path.join(RESULTS_DIR, d)).isDirectory(),
    )
    .sort()
    .reverse();
}

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("run");

  // List all runs
  if (!runId) {
    const runs = getRunDirs().map((dir) => {
      const meta = readJson(
        path.join(RESULTS_DIR, dir, "run-meta.json"),
      ) as Record<string, unknown> | null;
      return { id: dir, meta };
    });
    return NextResponse.json({ runs, dimensions: CDN_DIMENSIONS });
  }

  // Single run detail
  const runDir = path.join(RESULTS_DIR, runId);
  if (!fs.existsSync(runDir)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const meta = readJson(path.join(runDir, "run-meta.json"));

  // Read aggregated scores — check run-level first, then top-level
  let scores = readJson(path.join(runDir, "cdn-scores.json"));
  if (!scores) {
    scores = readJson(path.join(RESULTS_DIR, "cdn-scores.json"));
  }

  // Read raw scores
  let rawScores = readJson(path.join(runDir, "cdn-scores-raw.json"));
  if (!rawScores) {
    rawScores = readJson(path.join(RESULTS_DIR, "cdn-scores-raw.json"));
  }

  // Read session artifacts
  const artifactsDir = path.join(runDir, "artifacts");
  const artifacts: Record<string, unknown> = {};
  if (fs.existsSync(artifactsDir)) {
    for (const file of fs
      .readdirSync(artifactsDir)
      .filter((f) => f.endsWith(".json"))) {
      const key = file.replace(".json", "");
      artifacts[key] = readJson(path.join(artifactsDir, file));
    }
  }

  return NextResponse.json({
    id: runId,
    meta,
    scores,
    rawScores,
    artifacts,
    dimensions: CDN_DIMENSIONS,
  });
}
