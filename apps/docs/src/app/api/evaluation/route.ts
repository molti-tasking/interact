import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

const RESULTS_DIR = path.resolve(process.cwd(), "tests/evaluation/results");

const OLSEN_CRITERIA = [
  { id: "expressive-match", name: "Expressive Match" },
  { id: "expressive-leverage", name: "Expressive Leverage" },
  { id: "flexibility", name: "Flexibility" },
  { id: "reducing-skill-barrier", name: "Reducing Skill Barrier" },
];

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
        (d.startsWith("run-") ||
          d.startsWith("olsen-run-") ||
          d.startsWith("cdn-run-")) &&
        fs.statSync(path.join(RESULTS_DIR, d)).isDirectory(),
    )
    .sort()
    .reverse();
}

/**
 * The dashboard reads local evaluation results — a dev/research tool. In
 * production it is off unless explicitly enabled.
 */
function isEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.EVAL_DASHBOARD_ENABLED === "true"
  );
}

/** Basenames of the files in `dir` with the given extension (no traversal). */
function listFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(ext))
    .map((d) => d.name);
}

export async function GET(request: NextRequest) {
  if (!isEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const requestedRun = request.nextUrl.searchParams.get("run");

  // List all runs
  if (!requestedRun) {
    const runs = getRunDirs().map((dir) => {
      const meta = readJson(
        path.join(RESULTS_DIR, dir, "run-meta.json"),
      ) as Record<string, unknown> | null;
      return { id: dir, meta };
    });
    return NextResponse.json({
      runs,
      dimensions: CDN_DIMENSIONS,
      olsenCriteria: OLSEN_CRITERIA,
    });
  }

  // Single run detail — only ids of existing run directories are accepted,
  // so `?run=../..` can't escape RESULTS_DIR.
  const runId = getRunDirs().find((dir) => dir === requestedRun);
  if (!runId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const runDir = path.join(RESULTS_DIR, runId);

  const meta = readJson(path.join(runDir, "run-meta.json"));

  // Read aggregated scores — check run-level first, then top-level
  let scores = readJson(path.join(runDir, "cdn-scores.json"));
  if (!scores) {
    scores = readJson(path.join(RESULTS_DIR, "cdn-scores.json"));
  }

  // Read session artifacts
  const artifactsDir = path.join(runDir, "artifacts");
  const artifacts: Record<string, unknown> = {};
  for (const file of listFiles(artifactsDir, ".json")) {
    const key = file.replace(".json", "");
    artifacts[key] = readJson(path.join(artifactsDir, file));
  }

  // Olsen-specific scores (for olsen-run-* directories)
  const olsenScores = readJson(path.join(runDir, "olsen-scores.json"));
  const olsenRaw = readJson(path.join(runDir, "olsen-scores-raw.json"));
  const olsenPerRole = readJson(path.join(runDir, "olsen-per-role.json"));
  const olsenLimitations = readJson(path.join(runDir, "olsen-limitations.json"));
  const olsenBaselines = readJson(path.join(runDir, "olsen-baselines.json"));
  const olsenMetrics = readJson(path.join(runDir, "olsen-metrics.json"));

  // Human CDN scores (for cdn-run-* directories with completed ratings)
  const humanScores = readJson(path.join(runDir, "cdn-scores-human.json"));
  const agreement = readJson(path.join(runDir, "cdn-agreement.json"));

  // List available videos (names only — the dashboard doesn't serve them)
  const videos = listFiles(path.join(runDir, "videos"), ".webm");

  return NextResponse.json({
    id: runId,
    meta,
    scores,
    artifacts,
    dimensions: CDN_DIMENSIONS,
    olsenCriteria: OLSEN_CRITERIA,
    olsenScores,
    olsenRaw,
    olsenPerRole,
    olsenLimitations,
    olsenBaselines,
    olsenMetrics,
    humanScores,
    agreement,
    videos,
  });
}
