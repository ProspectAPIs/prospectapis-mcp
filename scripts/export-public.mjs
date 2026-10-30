#!/usr/bin/env node
// Builds the tree the PUBLIC repository github.com/ProspectAPIs/prospectapis-mcp
// receives, and refuses it if it carries a foreign-tenant identity.
//
// prepublish-tenant-check.mjs scans only the npm publish set (`files` in
// package.json). The public repository gets MORE than that: scripts/, test/,
// server.json and the registry pin. Measured 2026-10-29: a comment in
// scripts/prepublish-tenant-check.mjs named another tenant, npm was clean
// because scripts/ never ships there, and the public export would have carried
// it because nothing scanned the export.
//
// The export is `git archive <ref> mcp`, so .gitattributes export-ignore is
// honoured (archiving the subtree `<ref>:mcp` would NOT honour it: the
// attribute paths are rooted at the repository, measured the same day).
//
// Usage:
//   node scripts/export-public.mjs [--ref origin/main] [--into <public clone>]
// Without --into it prints the scratch directory holding the clean export.
// With --into it replaces that clone's tracked content (keeping .git) so the
// diff can be reviewed and committed there.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const ref = arg("--ref", "origin/main");
const into = arg("--into", null);

const repoRoot = execFileSync("git", ["-C", PKG_ROOT, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" }).trim();

const scratch = mkdtempSync(join(tmpdir(), "prospectapis-mcp-export-"));
const tarPath = join(scratch, "mcp.tar");
const dest = join(scratch, "export");
execFileSync("git", ["-C", repoRoot, "archive", "-o", tarPath, sha, "mcp"]);
execFileSync("mkdir", ["-p", dest]);
execFileSync("tar", ["-x", "-f", tarPath, "-C", dest, "--strip-components", "1"]);
rmSync(tarPath);

const count = execFileSync("find", [dest, "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
if (count === 0) {
  console.error(`[export-public] BLOCKED: the export of ${sha} under mcp/ is empty.`);
  process.exit(1);
}

try {
  execFileSync(
    "python3",
    [join(process.env.HOME, ".claude/scripts/tenant-isolation-scan.py"), "--tenant", "prospectapis", "--path", dest],
    { stdio: "inherit" },
  );
} catch {
  console.error(`\n[export-public] BLOCKED: the public export of ${sha} failed the tenant isolation scan.`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}
console.log(`[export-public] PASS: ${count} file(s) from ${sha.slice(0, 12)} clean of foreign-tenant identity.`);

if (!into) {
  console.log(`[export-public] export at ${dest}`);
  process.exit(0);
}
if (!existsSync(join(into, ".git"))) {
  console.error(`[export-public] BLOCKED: --into ${into} is not a git clone.`);
  process.exit(1);
}
for (const entry of readdirSync(into)) {
  if (entry !== ".git") rmSync(join(into, entry), { recursive: true, force: true });
}
cpSync(dest, into, { recursive: true });
rmSync(scratch, { recursive: true, force: true });
console.log(`[export-public] synced into ${into}; review with git -C ${into} status, then commit as the ProspectAPIs identity.`);
