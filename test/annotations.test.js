// Tool titles and annotations as a client sees them, read from tools/list over an in-memory transport.
//
// Before 0.2.4 every tool's title was its raw name (a client showed "watchlist_delete") and every write,
// watchlist_delete included, said destructiveHint: false, so a client could delete a watchlist and its delivery
// history without the confirmation it gives a destructive tool. annotationProblems() is the rule; the tests run it on
// what the server serves and, as mutations, on copies with each regression planted, so the rule is shown to fail.

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { TOOLS, annotationsFor } from "../src/tools.js";

// Repeating one of these with the same arguments changes nothing more. funding_search and funding_get are not here:
// they are read-only, but every call that returns records is billed again.
const IDEMPOTENT = new Set([
  "research_get", "watchlist_list", "watchlist_get", "watchlist_deliveries", "watchlist_delete",
  "account_balance", "pricing_get", "api_version", "email_domain_check", "email_verify_calibration",
]);

async function servedTools() {
  const { server } = createServer({ apiKey: "pa_live_" + "ab".repeat(24), fetchImpl: async () => new Response("{}") });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

// Every problem with a served tool list, one string each; [] when it is right.
function annotationProblems(tools) {
  const out = [];
  const writers = new Set(TOOLS.filter((t) => t.write).map((t) => t.name));
  for (const t of tools) {
    const a = t.annotations || {};
    for (const [where, title] of [["title", t.title], ["annotations.title", a.title]]) {
      if (typeof title !== "string" || title.trim() === "") out.push(`${t.name}: ${where} missing`);
      else if (title === t.name) out.push(`${t.name}: ${where} is the raw tool name`);
      else if (title.includes("_")) out.push(`${t.name}: ${where} "${title}" has an underscore`);
      else if (!/^[A-Z]/.test(title)) out.push(`${t.name}: ${where} "${title}" does not start with a capital`);
    }
    if (t.title !== a.title) out.push(`${t.name}: title and annotations.title differ`);
    const isDelete = t.name.endsWith("_delete");
    if (isDelete && a.destructiveHint !== true) out.push(`${t.name}: a delete without destructiveHint true`);
    if (isDelete && a.readOnlyHint !== false) out.push(`${t.name}: a delete without readOnlyHint false`);
    if (!isDelete && a.destructiveHint !== false) out.push(`${t.name}: destructiveHint should be false`);
    if (a.readOnlyHint !== !writers.has(t.name)) out.push(`${t.name}: readOnlyHint should be ${!writers.has(t.name)}`);
    if (a.idempotentHint !== IDEMPOTENT.has(t.name)) out.push(`${t.name}: idempotentHint should be ${IDEMPOTENT.has(t.name)}`);
    if (a.openWorldHint !== true) out.push(`${t.name}: openWorldHint should be true`);
  }
  const titles = tools.map((t) => t.title);
  if (new Set(titles).size !== titles.length) out.push("two tools share a title");
  return out;
}

test("every served tool has a human title and honest annotations", async () => {
  const tools = await servedTools();
  assert.equal(tools.length, TOOLS.length);
  // Positive controls, so the delete and read checks are not vacuous.
  assert.ok(tools.some((t) => t.name.endsWith("_delete")), "no *_delete tool to check");
  assert.ok(tools.some((t) => t.annotations.readOnlyHint === true), "no read-only tool to check");
  assert.deepEqual(annotationProblems(tools), []);
  const del = tools.find((t) => t.name === "watchlist_delete");
  assert.equal(del.title, "Delete Watchlist");
  assert.deepEqual(del.annotations, { title: "Delete Watchlist", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
  assert.equal(tools.find((t) => t.name === "funding_search").title, "Search Funding Rounds");
});

test("the served annotations are exactly annotationsFor(), the one factory the hosted door also uses", async () => {
  const tools = await servedTools();
  for (const tool of TOOLS) {
    const s = tools.find((t) => t.name === tool.name);
    assert.deepEqual(s.annotations, annotationsFor(tool), tool.name);
    assert.equal(s.title, tool.title, tool.name);
  }
});

// Mutations: each copy carries one regression the rule must catch.
test("mutation: the rule fails on each planted regression", async () => {
  const good = await servedTools();
  const mutate = (fn) => {
    const copy = structuredClone(good);
    fn(copy);
    return annotationProblems(copy);
  };
  const del = (tools) => tools.find((t) => t.name === "watchlist_delete");
  const search = (tools) => tools.find((t) => t.name === "funding_search");
  const cases = {
    // The pre-0.2.4 factory: title = name, destructiveHint false everywhere.
    "the old factory": (tools) => tools.forEach((t) => { t.title = t.name; t.annotations.title = t.name; t.annotations.destructiveHint = false; }),
    "a raw-name title": (tools) => { search(tools).title = "funding_search"; search(tools).annotations.title = "funding_search"; },
    "an underscore in a title": (tools) => { search(tools).title = "Search_Funding"; search(tools).annotations.title = "Search_Funding"; },
    "a missing title": (tools) => { delete search(tools).title; delete search(tools).annotations.title; },
    "a non-destructive delete": (tools) => { del(tools).annotations.destructiveHint = false; },
    "a read-only delete": (tools) => { del(tools).annotations.readOnlyHint = true; },
    "a destructive read": (tools) => { search(tools).annotations.destructiveHint = true; },
    "a paid read marked idempotent": (tools) => { search(tools).annotations.idempotentHint = true; },
    "a closed-world tool": (tools) => { search(tools).annotations.openWorldHint = false; },
  };
  for (const [name, fn] of Object.entries(cases)) {
    assert.ok(mutate(fn).length > 0, `the rule did not catch ${name}`);
  }
  assert.ok(mutate(cases["the old factory"]).some((p) => p.includes("raw tool name")));
  assert.ok(mutate(cases["the old factory"]).some((p) => p.includes("watchlist_delete: a delete without destructiveHint true")));
});
