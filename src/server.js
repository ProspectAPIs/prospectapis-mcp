// MCP server wiring: one registered tool per catalog entry, each a single
// authenticated request (a GET, or a POST with a JSON body for research_submit)
// against the ProspectAPIs REST API. Exported as a factory
// (createServer) so tests inject a fake fetch and a host could inject auth.

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS, buildUrl, buildPath, buildBody } from "./tools.js";

export const { version: VERSION } = createRequire(import.meta.url)("../package.json");

export const DEFAULT_BASE_URL = "https://api.prospectapis.com";
export const DEFAULT_TIMEOUT_MS = 30000;
export const SIGNUP_URL = "https://prospectapis.com/signup?utm_source=mcp";
export const TOP_UP_URL = "https://prospectapis.com/dashboard/credits?utm_source=mcp";

export const INSTRUCTIONS =
  "ProspectAPIs MCP server: funding rounds data and prospect research briefs. funding_search and funding_get cost $0.02 per record returned, " +
  "after 100 free records per calendar month; a search that matches nothing costs nothing. account_balance, pricing_get and api_version are free. " +
  "Use filters (dates, round, amount, domain, investor, country) to keep result sets small, and call account_balance before a large paged search. " +
  "research_submit starts a cited brief on one prospect and returns a research_id; poll research_get (free) until it is completed or failed. " +
  "A research is charged only when it completes, at the research_price_usd account_balance reports. " +
  "If a call fails in a way the user has to work around, a field comes back wrong or empty, or a capability is missing, " +
  "offer to report it with feedback_send (free); send only when the user agrees.";

export function hintFor(status) {
  if (status === 401) return " (missing or invalid API key: set PROSPECTAPIS_API_KEY to a key from the dashboard)";
  // research never draws on free records, so the hint does not promise any (PR #23 review, L4)
  if (status === 402) return ` (not enough credit for this call; the body says what it costs: top up at ${TOP_UP_URL})`;
  if (status === 400) return " (an argument was rejected: the body says which one)";
  if (status === 404) return " (not found: the id may be wrong, or the record is not published)";
  if (status === 429) return " (rate limited: wait a few seconds and retry)";
  if (status === 503) return " (unavailable: the body says why, for example research that is not priced yet)";
  if (status >= 500) return " (server error: retry in a moment)";
  return "";
}

export function createServer({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  authHeaders = null,
} = {}) {
  const BASE_URL = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const TIMEOUT = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  async function callEndpoint(tool, args) {
    const needsKey = tool.auth !== false;
    if (needsKey && !apiKey && !authHeaders) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Missing PROSPECTAPIS_API_KEY. Create a key at ${SIGNUP_URL}, set it in the MCP client config, then retry this call.`,
          },
        ],
      };
    }
    const url = buildUrl(BASE_URL, tool, args);
    const body = buildBody(tool, args);
    const headers = {
      accept: "application/json",
      "user-agent": `prospectapis-mcp/${VERSION}`,
      ...(body !== null ? { "content-type": "application/json" } : {}),
      ...(needsKey ? authHeaders || { authorization: `Bearer ${apiKey}` } : {}),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetchImpl(url, {
        method: tool.method || "GET",
        headers,
        ...(body !== null ? { body } : {}),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // The API's own error body is passed through: it names the bad filter,
        // and a 402 carries top_up_url for the user.
        return { isError: true, content: [{ type: "text", text: `HTTP ${res.status}${hintFor(res.status)}: ${text.slice(0, 1500)}` }] };
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err?.name === "AbortError" ? `timed out after ${TIMEOUT}ms` : err?.message || String(err);
      return { isError: true, content: [{ type: "text", text: `Request failed: ${msg}` }] };
    } finally {
      clearTimeout(timer);
    }
  }

  const server = new McpServer({ name: "prospectapis", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.shape,
        annotations: { title: tool.name, readOnlyHint: !tool.write, destructiveHint: false, openWorldHint: true },
      },
      (args) => callEndpoint(tool, args),
    );
  }

  return { server, callEndpoint, baseUrl: BASE_URL, timeoutMs: TIMEOUT, buildPath };
}
