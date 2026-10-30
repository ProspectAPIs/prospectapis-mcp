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
// attribute paths are rooted at the repository, measured the same day). This
// file ships in the export (package.json names it, and test/package-scripts
// checks that every script file exists), though it only runs in the monorepo.
//
// Usage:
//   node scripts/export-public.mjs [--ref origin/main] [--into <public clone>]
// Without --into it prints the scratch directory holding the clean export.
// With --into it replaces that clone's content (keeping .git and .gitignore) so
// the diff can be reviewed and committed there. The clone must be a clean clone
// of the public repository, outside this monorepo.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, cpSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_REPO = "ProspectAPIs/prospectapis-mcp";
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`[export-public] BLOCKED: ${msg}`);
  process.exit(1);
}
function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) die(`${name} needs a value.`);
  return v;
}
const ref = arg("--ref", "origin/main");
const into = arg("--into", null);

const repoRoot = realpathSync(
  execFileSync("git", ["-C", PKG_ROOT, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
);
const sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" }).trim();

// The --into target is checked BEFORE anything is built: the sync deletes its content.
if (into) {
  if (!existsSync(join(into, ".git"))) die(`--into ${into} is not a git clone.`);
  const target = realpathSync(into);
  if (target === repoRoot || target.startsWith(repoRoot + sep) || repoRoot.startsWith(target + sep))
    die(`--into ${target} overlaps this monorepo (${repoRoot}); it must be a separate clone of ${PUBLIC_REPO}.`);
  const origin = execFileSync("git", ["-C", target, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  if (!new RegExp(`[/:]${PUBLIC_REPO}(\\.git)?$`, "i").test(origin))
    die(`--into ${target} has origin ${origin}, not ${PUBLIC_REPO}.`);
  const dirty = execFileSync("git", ["-C", target, "status", "--porcelain", "--ignored"], { encoding: "utf8" }).trim();
  if (dirty) die(`--into ${target} has uncommitted or ignored files; the sync would delete them. Use a fresh clone.`);
}

const scratch = mkdtempSync(join(tmpdir(), "prospectapis-mcp-export-"));
const dest = join(scratch, "export");
let keepScratch = false;
// die() calls process.exit, which skips a pending finally, so a refusal inside the try throws this instead.
class Refused extends Error {}
try {
  const tarPath = join(scratch, "mcp.tar");
  execFileSync("git", ["-C", repoRoot, "archive", "-o", tarPath, sha, "mcp"]);
  execFileSync("mkdir", ["-p", dest]);
  execFileSync("tar", ["-x", "-f", tarPath, "-C", dest, "--strip-components", "1"]);
  rmSync(tarPath);

  const count = execFileSync("find", [dest, "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
  if (count === 0) throw new Refused(`the export of ${sha} under mcp/ is empty.`);

  try {
    execFileSync(
      "python3",
      [join(process.env.HOME, ".claude/scripts/tenant-isolation-scan.py"), "--tenant", "prospectapis", "--path", dest],
      { stdio: "inherit" },
    );
  } catch {
    throw new Refused(`the public export of ${sha} failed the tenant isolation scan.`);
  }
  // The export must pass the public repository's own dependency-free check, which asserts every file an npm
  // script runs exists. Export-ignoring a script file broke it once (2026-10-29 review).
  try {
    execFileSync("node", ["--test", "test/package-scripts.test.js"], { cwd: dest, stdio: "pipe" });
  } catch (e) {
    throw new Refused(`the export's own test/package-scripts.test.js fails:\n${(e.stdout || "").toString().slice(-800)}`);
  }
  console.log(`[export-public] PASS: ${count} file(s) from ${sha.slice(0, 12)} clean of foreign-tenant identity.`);

  if (!into) {
    keepScratch = true;
    console.log(`[export-public] export at ${dest}`);
  } else {
    // The public repository owns its .gitignore (the monorepo's lives at its root, outside mcp/), so the
    // first --into run deleted it (2026-10-29). Everything else mirrors the export, deletions included.
    const PUBLIC_OWNED = new Set([".git", ".gitignore"]);
    for (const entry of readdirSync(into)) {
      if (!PUBLIC_OWNED.has(entry)) rmSync(join(into, entry), { recursive: true, force: true });
    }
    cpSync(dest, into, { recursive: true });
    console.log(`[export-public] synced into ${into}; review with git -C ${into} status, then commit as the ProspectAPIs identity.`);
  }
} catch (e) {
  rmSync(scratch, { recursive: true, force: true });
  if (e instanceof Refused) die(e.message);
  throw e;
} finally {
  if (!keepScratch) rmSync(scratch, { recursive: true, force: true });
}
