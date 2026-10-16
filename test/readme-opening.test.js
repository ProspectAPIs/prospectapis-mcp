// readme-opening.test.js: the first paragraph of README.md is the text that
// Glama, mcpservers.org, the MCP Registry and npm copy word for word into their
// listings, so it is a published surface. These checks hold the README to facts
// read from the shipped package, never from another document: the opening names
// the package, its Website line is server.json websiteUrl, every tool count it
// states (in digits or in words) is the live catalog in src/tools.js, the Node
// floor it states is package.json engines, and the version is one number across
// package.json, server.json and package-lock.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../src/tools.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const readme = read("README.md");
const pkg = JSON.parse(read("package.json"));
const srv = JSON.parse(read("server.json"));
const lock = JSON.parse(read("package-lock.json"));

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const toNumber = (s) => (/^\d+$/.test(s) ? Number(s) : WORDS.indexOf(s.toLowerCase()));

const blocks = readme.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
const opening = blocks.find((b) => !b.startsWith("#") && !b.startsWith("[![") && !b.startsWith("|"));

test("the opening names the package and fits a listing", () => {
  assert.ok(opening, "README.md has an opening paragraph after the H1");
  assert.ok(opening.startsWith(`${pkg.name} is the MCP server for`), `opening starts with the package name, got: ${opening.slice(0, 80)}`);
  const words = opening.split(/\s+/).length;
  assert.ok(words <= 130, `the opening is ${words} words; listings copy about the first 120`);
  assert.ok(!/[–—]/.test(opening), "no en or em dash in the opening");
  // The prices the opening states are the live ones (api pricing endpoint, read 2026-10-16:
  // $0.02 each after 100 free a month, research $0.15). A changed price edits both.
  for (const claim of ["$0.02 each", "100 free", "$0.15"]) {
    assert.ok(opening.includes(claim), `the opening no longer states "${claim}"; update the price here and in the opening together`);
  }
});

test("the Website line is server.json websiteUrl", () => {
  const site = readme.match(/^Website: (\S+)\s*$/m);
  assert.ok(site, 'README.md has a "Website: <url>" line');
  assert.equal(site[1], srv.websiteUrl);
});

test("every tool count the README states is the catalog", () => {
  const re = new RegExp(`\\b(\\d+|${WORDS.join("|")}) tools\\b`, "gi");
  const claims = [...readme.matchAll(re)].map((m) => m[1]);
  assert.ok(claims.length > 0, "the README states a tool count; otherwise this check is vacuous");
  for (const c of claims) assert.equal(toNumber(c), TOOLS.length, `README says "${c} tools" but src/tools.js registers ${TOOLS.length}`);
});

test("the Node floor in the opening is package.json engines", () => {
  const stated = opening.match(/Node\.js (\d+) or later/);
  assert.ok(stated, "the opening states the Node floor");
  assert.equal(`>=${stated[1]}`, pkg.engines.node);
});

test("one version across package.json, server.json and package-lock.json", () => {
  const versions = {
    "package.json": pkg.version,
    "server.json version": srv.version,
    "server.json packages[0].version": srv.packages?.[0]?.version,
    "package-lock.json": lock.version,
    'package-lock.json packages[""].version': lock.packages?.[""]?.version,
  };
  assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
});
