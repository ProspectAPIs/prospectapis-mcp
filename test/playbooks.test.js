// Playbooks over the MCP resource and prompt primitives, end to end over an in-memory transport: every playbook is
// listed and readable, every prompt hands over the same text resources/read serves, a prompt with an optional
// argument works with and without it (and with `arguments` left out entirely), a playbook only names tools the
// catalog has, and the listed descriptions stay plain product text.

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GetPromptResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/server.js";
import { TOOLS, RESEARCH_PURPOSES } from "../src/tools.js";
import { PLAYBOOKS, PLAYBOOK_MIME } from "../src/playbooks.js";

async function connect() {
  const { server } = createServer({ apiKey: "pa_live_" + "ab".repeat(24), fetchImpl: async () => new Response("{}") });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

test("resources: every playbook is listed with its title and mime type, and reads back byte for byte", async () => {
  const client = await connect();
  assert.ok(client.getServerCapabilities().resources, "the resources capability is declared");
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri).sort(), PLAYBOOKS.map((p) => p.uri).sort());
  for (const p of PLAYBOOKS) {
    const listed = resources.find((r) => r.uri === p.uri);
    assert.equal(listed.title, p.title);
    assert.equal(listed.mimeType, PLAYBOOK_MIME);
    const { contents } = await client.readResource({ uri: p.uri });
    assert.equal(contents.length, 1);
    assert.equal(contents[0].text, p.text, `${p.name} reads back exactly`);
    assert.equal(contents[0].mimeType, PLAYBOOK_MIME);
  }
});

test("prompts: one per playbook, each embedding the same text resources/read serves", async () => {
  const client = await connect();
  assert.ok(client.getServerCapabilities().prompts, "the prompts capability is declared");
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), PLAYBOOKS.map((p) => p.name).sort());
  for (const p of PLAYBOOKS) {
    const listed = prompts.find((x) => x.name === p.name);
    assert.equal(listed.description, p.description);
    const args = listed.arguments || [];
    if (p.prompt) {
      assert.deepEqual(args.map((a) => [a.name, Boolean(a.required)]), [[p.prompt.arg, false]], `${p.name} takes one optional argument`);
    } else {
      assert.equal(args.length, 0, `${p.name} takes no argument`);
    }
    const got = await client.getPrompt({ name: p.name, arguments: {} });
    assert.equal(got.messages[0].content.type, "resource");
    assert.equal(got.messages[0].content.resource.uri, p.uri);
    assert.equal(got.messages[0].content.resource.text, p.text, "the prompt hands over the served recipe, not a copy");
    assert.equal(got.messages[1].content.text, "Run this playbook.");
  }
});

test("prompts: an argument is passed through, and a client that omits `arguments` entirely still gets the prompt", async () => {
  const client = await connect();
  const withArg = await client.getPrompt({ name: "pre-call-brief", arguments: { prospect: "acme.com" } });
  assert.equal(withArg.messages[1].content.text, "Run this playbook for: acme.com");
  const blank = await client.getPrompt({ name: "newly-funded-prospects", arguments: { profile: "   " } });
  assert.equal(blank.messages[1].content.text, "Run this playbook.", "a blank optional field is the plain prompt");
  // The raw request with no `arguments` key at all: the SDK would answer -32602 without the default the server adds.
  const raw = await client.request({ method: "prompts/get", params: { name: "investor-rounds" } }, GetPromptResultSchema);
  assert.equal(raw.messages[0].content.resource.uri, "prospectapis://playbooks/investor-rounds");
  await assert.rejects(client.getPrompt({ name: "pre-call-brief", arguments: { prospect: "x".repeat(201) } }), "an over-long argument is refused");
});

// Response fields a playbook may name: they are what a tool RETURNS, so they are in no input schema.
const RESPONSE_FIELDS = new Set(["research_id", "next_cursor", "research_price_usd", "status", "result", "secret"]);
// Parameter VALUES a playbook may name, read from the catalog so a renamed value fails here.
const VALUES = new Set(RESEARCH_PURPOSES);

test("playbook bodies name only real tools, tool parameters or response fields, and every playbook names a tool", () => {
  const tools = new Set(TOOLS.map((t) => t.name));
  const params = new Set(TOOLS.flatMap((t) => Object.keys(t.shape || {})));
  for (const p of PLAYBOOKS) {
    const named = [...p.text.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
    assert.ok(named.some((n) => tools.has(n)), `${p.name} names a tool`);
    for (const n of named) {
      if (!n.includes("_")) continue;   // a plain word in code style
      assert.ok(tools.has(n) || params.has(n) || RESPONSE_FIELDS.has(n) || VALUES.has(n), `${p.name} names ${n}, which is no tool, parameter, value or response field`);
    }
  }
});

test("listed text stays plain product text: no tool names, no model instructions, no dashes, no other brand", () => {
  const toolNames = TOOLS.map((t) => t.name);
  for (const p of PLAYBOOKS) {
    const listed = `${p.title} ${p.description}`;
    for (const n of toolNames) assert.ok(!listed.includes(n), `${p.name}'s listed text names the tool ${n}`);
    assert.ok(!/\b(you must|always call|never call|ignore|before calling)\b/i.test(listed), `${p.name}'s listed text instructs the model`);
    assert.ok(!/[–—]/.test(listed + p.text), `${p.name} has an en or em dash`);
    assert.ok(/^prospectapis:\/\/playbooks\/[a-z-]+$/.test(p.uri) && p.uri.endsWith(p.name));
  }
});
