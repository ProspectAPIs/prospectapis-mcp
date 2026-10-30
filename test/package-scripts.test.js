// package-scripts.test.js: every file an npm script runs with `node <file>`
// must exist in this checkout, so `npm publish` and `npm run <script>` cannot
// fail with "Cannot find module" in a copy that leaves a folder out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("every file an npm script runs exists", () => {
  const refs = [];
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const m of cmd.matchAll(/\bnode\s+(?:--\S+\s+)*([^\s"'&|;]+\.(?:m?js|cjs))/g)) refs.push([name, m[1]]);
  }
  assert.ok(refs.length > 0, "at least one script runs a file; otherwise this check is vacuous");
  const missing = refs.filter(([, f]) => !existsSync(join(root, f))).map(([n, f]) => `${n}: ${f}`);
  assert.deepEqual(missing, [], `npm scripts run files that are not in this checkout: ${missing.join(", ")}`);
});
