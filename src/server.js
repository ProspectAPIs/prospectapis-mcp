// MCP server wiring: one registered tool per catalog entry, each a single
// authenticated request (a GET, or a POST with a JSON body for research_submit and email_verify)
// against the ProspectAPIs REST API. Exported as a factory
// (createServer) so tests inject a fake fetch and a host could inject auth.

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS, buildUrl, buildPath, buildBody, annotationsFor } from "./tools.js";
import { z } from "zod";
import { GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PLAYBOOKS, PLAYBOOK_MIME } from "./playbooks.js";

export const { version: VERSION } = createRequire(import.meta.url)("../package.json");

export const DEFAULT_BASE_URL = "https://api.prospectapis.com";
export const DEFAULT_TIMEOUT_MS = 30000;
export const SIGNUP_URL = "https://prospectapis.com/signup?utm_source=mcp";
export const TOP_UP_URL = "https://prospectapis.com/dashboard/billing?utm_source=mcp";

export const INSTRUCTIONS =
  "ProspectAPIs MCP server: funding rounds data, email verification and prospect research briefs. Every account starts with a free $1 balance " +
  "(no card, no monthly reset), and each paid call draws from it at its own price. funding_search and funding_get cost $0.02 per record returned; " +
  "a search that matches nothing costs nothing. email_verify checks 1 to 25 addresses for $0.004 per valid or invalid result; catch-all and " +
  "unknown results are free. account_balance, pricing_get and api_version are free. " +
  "Use filters (dates, round, amount, domain, investor, country) to keep result sets small, and call account_balance before a large paged search. " +
  "research_submit starts a cited brief on one prospect and returns a research_id; poll research_get (free) until it is completed or failed. " +
  "A research is charged only when it completes, at the research_price_usd account_balance reports. " +
  "If a call fails in a way the user has to work around, a field comes back wrong or empty, or a capability is missing, " +
  "offer to report it with feedback_send (free); send only when the user agrees.";

export function hintFor(status) {
  if (status === 401) return " (missing or invalid API key: set PROSPECTAPIS_API_KEY to a key from the dashboard)";
  if (status === 402) return ` (out of credits for this call; the body says what it costs: top up at ${TOP_UP_URL})`;
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

  // Playbooks (src/playbooks.js): each one a resource (resources/list, resources/read) and a prompt (prompts/list,
  // prompts/get). The prompt hands the playbook over as an embedded resource, so the recipe a user picks is exactly
  // the one resources/read serves. Registering either declares that capability, which a server with none does not
  // advertise.
  for (const p of PLAYBOOKS) {
    server.registerResource(
      p.name,
      p.uri,
      { title: p.title, description: p.description, mimeType: PLAYBOOK_MIME },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: PLAYBOOK_MIME, text: p.text }] }),
    );
  }
  // `arguments` is optional on prompts/get (MCP spec), but the SDK validates a prompt that declares arguments against
  // a required object, so a client that leaves it out would get -32602 for an argument it was told is optional. The
  // SDK installs its prompts/get handler through the low-level Server the first time a prompt is registered; wrapping
  // setRequestHandler before that defaults a missing `arguments` to {} and leaves every other request untouched.
  {
    const low = server.server;
    const setRequestHandler = low.setRequestHandler.bind(low);
    low.setRequestHandler = (schema, handler) =>
      setRequestHandler(
        schema,
        schema === GetPromptRequestSchema
          ? (request, extra) => handler({ ...request, params: { ...request.params, arguments: request.params?.arguments ?? {} } }, extra)
          : handler,
      );
  }
  for (const p of PLAYBOOKS) {
    const argsSchema = p.prompt ? { [p.prompt.arg]: z.string().max(200).optional().describe(p.prompt.describe) } : undefined;
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description, ...(argsSchema ? { argsSchema } : {}) },
      async (args = {}) => {
        const v = p.prompt ? String(args[p.prompt.arg] ?? "").trim() : "";
        return {
          description: p.description,
          messages: [
            { role: "user", content: { type: "resource", resource: { uri: p.uri, mimeType: PLAYBOOK_MIME, text: p.text } } },
            { role: "user", content: { type: "text", text: p.prompt && v ? p.prompt.ask(v) : "Run this playbook." } },
          ],
        };
      },
    );
  }

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.shape,
        annotations: annotationsFor(tool),
      },
      (args) => callEndpoint(tool, args),
    );
  }

  return { server, callEndpoint, baseUrl: BASE_URL, timeoutMs: TIMEOUT, buildPath };
}
