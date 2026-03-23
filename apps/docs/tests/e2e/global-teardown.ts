import fs from "fs";
import path from "path";

export default async function globalTeardown() {
  const scenarioFile = path.resolve(
    process.cwd(),
    "tests/fixtures/.active-scenario",
  );
  if (fs.existsSync(scenarioFile)) {
    fs.unlinkSync(scenarioFile);
  }
}
