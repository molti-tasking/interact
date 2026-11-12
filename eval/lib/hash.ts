import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * One hash over a directory's files (sorted paths, their bytes), for
 * recording which frozen material an output was computed from. Files whose
 * name matches `exclude` are left out.
 */
export function hashTree(dir: string, exclude: RegExp = /^$/): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (exclude.test(entry.name)) continue;
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const h = crypto.createHash("sha256");
  for (const file of files) {
    h.update(path.relative(dir, file));
    h.update("\0");
    h.update(fs.readFileSync(file));
    h.update("\0");
  }
  return h.digest("hex");
}
