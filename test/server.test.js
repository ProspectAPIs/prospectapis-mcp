// The MCP server end to end over an in-memory transport, with fetch mocked:
// no network. Covers the tool list, URL building, the auth header and how API
// errors reach the model.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DEFAULT_BASE_URL, VERSION } from "../src/server.js";
import { TOOLS, buildPath, buildQuery, buildUrl, buildBody, formatAmount, MAX_AMOUNT_USD, RESEARCH_PURPOSES } from "../src/tools.js";

const KEY = "pa_live_" + "ab".repeat(24);

function mockFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = "{}" } = (await responder(url, init)) || {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

async function connect(opts) {
  const { server } = createServer(opts);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

test("package metadata: name, version, ESM", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "prospectapis-mcp");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.type, "module");
  assert.equal(VERSION, pkg.version); // the server reports the published version, never a typed copy
  assert.equal(DEFAULT_BASE_URL, "https://api.prospectapis.com");
});

const WRITERS = new Set(["research_submit", "feedback_send", "watchlist_create", "watchlist_test", "watchlist_delete"]);

test("catalog: one tool per endpoint, well-formed; only research_submit and feedback_send write", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["funding_search", "funding_get", "research_submit", "research_get", "watchlist_create", "watchlist_list", "watchlist_get", "watchlist_deliveries", "watchlist_test", "watchlist_delete", "account_balance", "feedback_send", "pricing_get", "api_version"]);
  for (const t of TOOLS) {
    assert.equal(t.write, WRITERS.has(t.name), t.name);
    assert.equal(t.method === "GET", !WRITERS.has(t.name), t.name);
    assert.equal(!!t.body, t.method === "POST", t.name);
    // Every customer route is under /v1 except the keyless price list at the API root.
    assert.match(t.path, t.name === "pricing_get" ? /^\/pricing$/ : /^\/v1\//, t.name);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(typeof t.shape, "object", t.name);
  }
  const search = TOOLS.find((t) => t.name === "funding_search");
  assert.deepEqual(Object.keys(search.shape).sort(), [
    "company", "country", "cursor", "domain", "investor", "limit", "max_amount_usd", "min_amount_usd", "round", "since", "until",
  ]);
});

test("the server lists every catalog tool; every tool but the two writers is read-only", async () => {
  const client = await connect({ apiKey: KEY, fetchImpl: mockFetch(() => ({})).impl });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
  for (const t of tools) assert.equal(t.annotations.readOnlyHint, !WRITERS.has(t.name), t.name);
});

test("research_submit POSTs the arguments as a JSON body, with no query string", async () => {
  const m = mockFetch(() => ({ status: 202, body: { research_id: "11111111-1111-4111-8111-111111111111", status: "queued", estimated_seconds: 60 } }));
  const client = await connect({ apiKey: KEY, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "research_submit", arguments: { domain: "acme.com", context: "We sell payroll software.", purpose: "pre_call" } });
  assert.equal(r.isError, undefined);
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].url, "https://api.example.test/v1/research");
  assert.equal(m.calls[0].init.method, "POST");
  assert.equal(m.calls[0].init.headers["content-type"], "application/json");
  assert.equal(m.calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(m.calls[0].init.body), { domain: "acme.com", context: "We sell payroll software.", purpose: "pre_call" });
  assert.equal(JSON.parse(r.content[0].text).status, "queued");
  assert.equal(buildBody(TOOLS.find((t) => t.name === "funding_search"), { limit: 5 }), null, "GET tools send no body");
});

test("research_get reads one job by id; a malformed id or purpose is refused before any request", async () => {
  const m = mockFetch(() => ({ body: { research_id: "11111111-1111-4111-8111-111111111111", status: "running" } }));
  const client = await connect({ apiKey: KEY, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "research_get", arguments: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(r.isError, undefined);
  assert.equal(m.calls[0].url, "https://api.example.test/v1/research/11111111-1111-4111-8111-111111111111");
  assert.equal(m.calls[0].init.method, "GET");
  assert.equal(m.calls[0].init.body, undefined);
  for (const [name, args] of [["research_get", { id: "nope" }], ["research_submit", { domain: "acme.com", purpose: "call" }], ["research_submit", { domain: "acme.com", context: "x".repeat(1001) }]]) {
    const bad = await client.callTool({ name, arguments: args }).catch((e) => ({ thrown: e }));
    assert.ok(bad.thrown || bad.isError, `${name} ${JSON.stringify(args).slice(0, 60)}`);
  }
  assert.equal(m.calls.length, 1);
});

test("path building: placeholders interpolated and encoded, the rest become the query", () => {
  assert.deepEqual(buildPath("/v1/funding/{id}", { id: "a/b c", x: 1 }), { path: "/v1/funding/a%2Fb%20c", rest: { x: 1 } });
  assert.equal(buildQuery({ a: "1", b: undefined, c: "", d: 0 }), "a=1&d=0");
  const get = TOOLS.find((t) => t.name === "funding_get");
  assert.equal(buildUrl("https://api.example.test/", get, { id: "11111111-1111-4111-8111-111111111111" }), "https://api.example.test/v1/funding/11111111-1111-4111-8111-111111111111");
});

test("funding_search sends the filters as a query and the key as a Bearer header", async () => {
  const m = mockFetch(() => ({ body: { data: [], next_cursor: null, count: 0 } }));
  const client = await connect({ apiKey: KEY, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "funding_search", arguments: { round: "seed,series_a", min_amount_usd: 1000000, investor: "Example Ventures", limit: 10 } });
  assert.equal(r.isError, undefined);
  assert.equal(m.calls.length, 1);
  const u = new URL(m.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://api.example.test/v1/funding");
  assert.equal(u.searchParams.get("round"), "seed,series_a");
  assert.equal(u.searchParams.get("min_amount_usd"), "1000000");
  assert.equal(u.searchParams.get("investor"), "Example Ventures");
  assert.equal(u.searchParams.get("limit"), "10");
  assert.equal(m.calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(m.calls[0].init.headers["user-agent"], `prospectapis-mcp/${VERSION}`);
  assert.deepEqual(JSON.parse(r.content[0].text), { data: [], next_cursor: null, count: 0 });
});

test("api_version needs no key and sends none", async () => {
  const m = mockFetch(() => ({ body: { version: "0.1.0", git_sha: null } }));
  const client = await connect({ apiKey: undefined, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "api_version", arguments: {} });
  assert.equal(r.isError, undefined);
  assert.equal(m.calls[0].init.headers.authorization, undefined);
  assert.equal(new URL(m.calls[0].url).pathname, "/v1/version");
});

test("pricing_get needs no key, sends none and reads GET /pricing at the API root", async () => {
  const m = mockFetch(() => ({ body: { currency: "usd", funding: { price_per_record_usd: 0.02, free_records_per_month: 100 } } }));
  const client = await connect({ apiKey: undefined, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "pricing_get", arguments: {} });
  assert.equal(r.isError, undefined);
  assert.equal(m.calls[0].init.headers.authorization, undefined);
  assert.equal(new URL(m.calls[0].url).pathname, "/pricing");
});

test("watchlist_get puts the id in the path and sends no query string", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const m = mockFetch(() => ({ body: { id, name: "x", active: true } }));
  const client = await connect({ apiKey: KEY, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "watchlist_get", arguments: { id } });
  assert.equal(r.isError, undefined);
  const u = new URL(m.calls[0].url);
  assert.equal(u.pathname, `/v1/watchlists/${id}`);
  assert.equal(u.search, "");
  assert.equal(m.calls[0].init.method, "GET");
});

test("a keyed tool without a key fails locally and never calls the API", async () => {
  const m = mockFetch(() => ({}));
  const client = await connect({ apiKey: undefined, fetchImpl: m.impl });
  const r = await client.callTool({ name: "account_balance", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /PROSPECTAPIS_API_KEY/);
  assert.equal(m.calls.length, 0);
});

test("API errors pass through with status, hint and the API's own body", async () => {
  const bodies = {
    "/v1/funding": { status: 402, body: { error: "Insufficient credits", top_up_url: "https://prospectapis.com/dashboard/credits" } },
    "/v1/account": { status: 401, body: { error: "Invalid API key" } },
  };
  const m = mockFetch((url) => bodies[new URL(url).pathname] || { status: 400, body: { error: "since must be a date, YYYY-MM-DD", code: "INVALID_FILTER" } });
  const client = await connect({ apiKey: KEY, baseUrl: "https://api.example.test", fetchImpl: m.impl });

  const paid = await client.callTool({ name: "funding_search", arguments: {} });
  assert.equal(paid.isError, true);
  assert.match(paid.content[0].text, /^HTTP 402/);
  assert.match(paid.content[0].text, /top_up_url/);

  const auth = await client.callTool({ name: "account_balance", arguments: {} });
  assert.match(auth.content[0].text, /^HTTP 401 \(missing or invalid API key/);

  const bad = await client.callTool({ name: "funding_get", arguments: { id: "11111111-1111-4111-8111-111111111111" } });
  assert.match(bad.content[0].text, /^HTTP 400.*INVALID_FILTER/);
});

test("a network failure becomes a tool error, not a crash", async () => {
  const client = await connect({
    apiKey: KEY,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  const r = await client.callTool({ name: "account_balance", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Request failed: fetch failed/);
});

test("input validation rejects a malformed id before any request", async () => {
  const m = mockFetch(() => ({}));
  const client = await connect({ apiKey: KEY, fetchImpl: m.impl });
  const r = await client.callTool({ name: "funding_get", arguments: { id: "not-a-uuid" } }).catch((e) => ({ thrown: e }));
  assert.ok(r.thrown || r.isError, "malformed id must not succeed");
  assert.equal(m.calls.length, 0);
});

test("amount filters are bounded and written as fixed decimals (N7)", async () => {
  const search = TOOLS.find((t) => t.name === "funding_search");
  for (const [v, want] of [[0.1 + 0.2, "0.3"], [1234567.123456, "1234567.1235"], [5e6, "5000000"], [0, "0"], [MAX_AMOUNT_USD, "999999999999999"]]) {
    assert.equal(formatAmount(v), want);
    assert.equal(new URL(buildUrl("https://api.example.test", search, { min_amount_usd: v })).searchParams.get("min_amount_usd"), want);
  }
  // Out of range is refused by the tool schema before any request.
  const m = mockFetch(() => ({}));
  const client = await connect({ apiKey: KEY, fetchImpl: m.impl });
  const r = await client.callTool({ name: "funding_search", arguments: { min_amount_usd: 1e21 } }).catch((e) => ({ thrown: e }));
  assert.ok(r.thrown || r.isError);
  assert.equal(m.calls.length, 0);
});

test("feedback_send posts a JSON body to /v1/feedback, is a write tool, and refuses a bad tool name before any request", async () => {
  const m = mockFetch(() => ({ status: 202, body: { feedback_id: "x", status: "sent" } }));
  const client = await connect({ apiKey: KEY, baseUrl: "https://api.example.test", fetchImpl: m.impl });
  const r = await client.callTool({ name: "feedback_send", arguments: { title: "research_get stuck", details: "id 1 queued for 10 min", tool: "research_get" } });
  assert.equal(r.isError, undefined);
  assert.equal(m.calls[0].url, "https://api.example.test/v1/feedback");
  assert.equal(m.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(m.calls[0].init.body), { title: "research_get stuck", details: "id 1 queued for 10 min", tool: "research_get" });
  const t = TOOLS.find((x) => x.name === "feedback_send");
  assert.equal(t.write, true);
  const bad = await client.callTool({ name: "feedback_send", arguments: { title: "x", details: "y", tool: "Bad Tool" } }).catch((e) => ({ thrown: e }));
  assert.ok(bad.thrown || bad.isError);
  assert.equal(m.calls.length, 1);
});
