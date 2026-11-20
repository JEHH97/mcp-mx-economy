import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const excluded = new Set(["node_modules", "dist", "coverage", ".git"]);
const restricted = [
  [83, 105, 116, 101, 68, 111, 99],
  [65, 84, 76, 65, 83],
  [83, 75, 89, 76, 73, 78, 69],
  [76, 69, 78, 83],
  [79, 112, 115, 67, 101, 110, 116, 101, 114],
  [79, 110, 101, 87, 101, 98],
  [69, 117, 116, 101, 108, 115, 97, 116],
  [66, 101, 97, 109],
  [103, 105, 116, 46, 118, 105, 97, 115, 97, 116, 46, 99, 111, 109],
  [64, 118, 105, 97, 115, 97, 116, 46, 99, 111, 109],
  [99, 233, 100, 117, 108, 97],
].map((points) => String.fromCharCode(...points).toLowerCase());
const phoneLike =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{2,4}[\s.-]\d{3,4}/g;
const rootPath = fileURLToPath(root);
const failures = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!entry.isFile()) continue;
    const text = await readFile(path, "utf8").catch(() => "");
    const normalized = text.toLowerCase();
    for (const phrase of restricted) {
      if (normalized.includes(phrase))
        failures.push(`${relative(rootPath, path)}: restricted phrase`);
    }
    if (phoneLike.test(text))
      failures.push(`${relative(rootPath, path)}: phone-like number`);
    phoneLike.lastIndex = 0;
  }
}

await scan(rootPath);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Forbidden-content scan passed.");
}
