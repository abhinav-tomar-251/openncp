// Cross-platform test runner: discovers *.test.ts under ./src and runs them with
// Node's test runner + the tsx loader. Node's `--test` glob isn't reliable on
// Windows, so we enumerate files explicitly. Run from a package dir (cwd = package).
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

let entries = [];
try {
  entries = await readdir("src", { recursive: true });
} catch {
  console.log("no src/ directory — nothing to test");
  process.exit(0);
}

const files = entries
  .map((f) => String(f).replaceAll("\\", "/"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `src/${f}`);

if (files.length === 0) {
  console.log("no test files found");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
