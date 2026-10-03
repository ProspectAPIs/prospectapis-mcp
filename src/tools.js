// Tool catalog and pure request builders. Kept apart from the server wiring so
// the catalog is unit-tested without a transport or a network.
//
// One tool per REST endpoint. Each entry is { name, path, method, shape, write }:
//   - `shape` is the zod input schema; its keys map 1:1 to query parameters,
//     except `{name}` placeholders in `path`, which are interpolated into the
//     URL and removed from the query string;
//   - `body: true` sends the arguments as a JSON body instead of a query
//     string (research_submit, a POST);
//   - `write: true` marks a tool that changes state or spends credits
//     (research_submit starts a paid job); the server turns `write` into MCP's
//     readOnlyHint, so every other tool is read-only;
//   - `auth: false` marks the tools the API serves without a key (pricing_get, api_version).

import { z } from "zod";

// The API accepts an amount of at most 15 integer digits and 4 decimals
// (AMOUNT_RE in apps/api/src/services/funding.js). Numbers are bounded here and
// written as fixed decimals, so 0.1 + 0.2 or 1e21 can never reach the API as
// "0.30000000000000004" or "1e+21" and come back as a 400.
export const MAX_AMOUNT_USD = 999999999999999;
export function formatAmount(v) {
  return Number(v).toFixed(4).replace(/\.?0+$/, "");
}
const AMOUNT = z.number().nonnegative().max(MAX_AMOUNT_USD).optional();

// The research purposes the API accepts (apps/api/src/services/research.js).
export const RESEARCH_PURPOSES = ["account_research", "pre_call", "outreach"];
const URL_ARG = z.string().min(1).max(2048);

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .optional();

export const TOOLS = [
  {
    name: "funding_search",
    method: "GET",
    path: "/v1/funding",
    write: false,
    format: { min_amount_usd: formatAmount, max_amount_usd: formatAmount },
    description:
      "Search funding rounds (venture rounds, debt, grants, IPOs), newest announcement first. Costs $0.02 per record returned, after 100 free records a month; a search that matches nothing is free. " +
      "Page with `cursor`: pass back `next_cursor` exactly as returned; a null `next_cursor` means there are no more matches. Narrow with filters before raising `limit`.",
    shape: {
      since: DATE.describe("Earliest announcement date, inclusive (YYYY-MM-DD)."),
      until: DATE.describe("Latest announcement date, inclusive (YYYY-MM-DD)."),
      round: z
        .string()
        .optional()
        .describe("Comma-separated round stages, for example `seed,series_a,series_b`."),
      min_amount_usd: AMOUNT.describe("Smallest round size in USD."),
      max_amount_usd: AMOUNT.describe("Largest round size in USD."),
      company: z.string().min(1).max(100).optional().describe("Company name contains this text (case-insensitive)."),
      domain: z.string().min(3).max(253).optional().describe("Exact company domain, for example `example.com`."),
      investor: z.string().min(1).max(100).optional().describe("Exact investor name, case-insensitive."),
      country: z.string().min(1).max(60).optional().describe("Headquarters country, case-insensitive."),
      limit: z.number().int().min(1).max(100).optional().describe("Records per page, 1 to 100 (default 25). Each record returned is billed."),
      cursor: z.string().max(200).optional().describe("Opaque cursor from the previous page's `next_cursor`."),
    },
  },
  {
    name: "funding_get",
    method: "GET",
    path: "/v1/funding/{id}",
    write: false,
    description: "Read one funding record by id. Costs $0.02 when found (free records are used first); a missing id is free.",
    shape: {
      id: z.string().uuid().describe("The funding record id from a `funding_search` result."),
    },
  },
  {
    name: "research_submit",
    method: "POST",
    path: "/v1/research",
    write: true,
    body: true,
    description:
      "Start a cited pre-call research brief on one prospect: company, funding, traction, competitors, news, people, risks, regions, " +
      "plus a `fit` section when you pass `context`. Give exactly ONE identifier (domain, website_url, company_name, company_linkedin_url, " +
      "a work email, or linkedin_url), or person_name together with company_name. Returns `research_id` at once; the brief takes 20 to 90 seconds, " +
      "so poll research_get every 10 to 15 seconds until `status` is `completed` or `failed`. " +
      "Costs one research at the price account_balance reports as `research_price_usd`, held when you submit, charged only when the brief " +
      "completes and refunded in full if it fails. Free records do not apply.",
    shape: {
      domain: z.string().min(3).max(253).optional().describe("The company's domain, for example `acme.com`."),
      website_url: URL_ARG.optional().describe("Any http(s) URL on the company's website."),
      company_name: z.string().min(1).max(200).optional().describe("The company's name. With person_name, the company that person works at."),
      company_linkedin_url: URL_ARG.optional().describe("The company's linkedin.com/company/... URL, used as a name hint only."),
      email: z.string().min(3).max(254).optional().describe("A work email; its domain identifies the company. Free-mail addresses are refused."),
      person_name: z.string().min(1).max(200).optional().describe("A person's name; needs company_name as well."),
      linkedin_url: URL_ARG.optional().describe("A person's linkedin.com/in/... URL, used as a name hint only."),
      context: z.string().min(1).max(1000).optional().describe("Your own product, at most 1,000 characters. Turns on the `fit` section."),
      purpose: z
        .enum(RESEARCH_PURPOSES)
        .optional()
        .describe("What the brief is for: `account_research` (default), `pre_call` (objections, discovery questions) or `outreach` (sourced hooks with draft first lines)."),
    },
  },
  {
    name: "research_get",
    method: "GET",
    path: "/v1/research/{id}",
    write: false,
    description:
      "Read a research job by the `research_id` research_submit returned: `status` (queued, running, completed, failed), `input`, " +
      "`result` (the brief, once completed) and `error` (once failed). Free; only your own account's jobs are visible.",
    shape: {
      id: z.string().uuid().describe("The `research_id` from research_submit."),
    },
  },
  {
    name: "watchlist_create",
    method: "POST",
    path: "/v1/watchlists",
    body: true,
    write: true,
    description:
      "Save a funding-signal alert: a set of funding_search filters plus an https webhook. Each NEW funding event that " +
      "matches is POSTed to the webhook, signed with the returned `secret` (header Prospect-Signature: t=..,v1=HMAC-SHA256). " +
      "Creating is free; each delivered event costs one record ($0.02, free records first), charged only when the webhook " +
      "answers 2xx. The `secret` is shown once. Max 20 active per account.",
    shape: {
      name: z.string().min(1).max(100).describe("A label, such as 'Series A robotics'."),
      filters: z
        .object({
          round: z.string().optional(),
          min_amount_usd: z.number().nonnegative().optional(),
          max_amount_usd: z.number().nonnegative().optional(),
          company: z.string().optional(),
          domain: z.string().optional(),
          investor: z.string().optional(),
          country: z.string().optional(),
        })
        .describe("At least one funding_search filter; date windows and paging do not apply to alerts."),
      webhook_url: z.string().url().max(2048).describe("Your https endpoint on a public host."),
    },
  },
  {
    name: "watchlist_list",
    method: "GET",
    path: "/v1/watchlists",
    write: false,
    description: "Your funding-signal alerts (without their secrets). Free.",
    shape: {},
  },
  {
    name: "watchlist_get",
    method: "GET",
    path: "/v1/watchlists/{id}",
    write: false,
    description: "One funding-signal alert: its name, filters, webhook URL, whether it is active and why it was paused (never its secret). Free.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "watchlist_deliveries",
    method: "GET",
    path: "/v1/watchlists/{id}/deliveries",
    write: false,
    description: "The last 50 deliveries of one alert and their outcome (delivered, retry, failed, no_credit). Free.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "watchlist_test",
    method: "POST",
    path: "/v1/watchlists/{id}/test",
    body: true,
    write: true,
    description: "Send a signed sample event to the alert's webhook now, to build and verify the receiver. Free; 5 a minute.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "watchlist_delete",
    method: "DELETE",
    path: "/v1/watchlists/{id}",
    write: true,
    description: "Delete a funding-signal alert and its delivery history. Free.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "account_balance",
    method: "GET",
    path: "/v1/account",
    write: false,
    description: "Your credit balance and the free records left this month. Free. Check it before a large paged search.",
    shape: {},
  },
  {
    name: "feedback_send",
    method: "POST",
    path: "/v1/feedback",
    body: true,
    write: true,
    description:
      "Report a bug, a wrong or empty field, a missing capability or a question about ProspectAPIs to the team. Free; " +
      "limited to 10 delivered reports an hour per account (a 429 means wait, do not retry in a loop). Before reporting that a field is wrong or a parameter is ignored, re-run the " +
      "call with a value that could only match if it were honoured. Put the exact call, what came back and what you " +
      "expected in `details`; never include secrets or API keys. Send only when the user agrees.",
    shape: {
      kind: z.enum(["bug", "feature", "question"]).optional().describe("bug (default), feature or question."),
      title: z.string().min(1).max(200).describe("One line: what is wrong or missing."),
      details: z.string().min(1).max(8000).describe("The exact call, what came back, what you expected, and ids such as research_id."),
      tool: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/).optional().describe("The tool the report is about, such as research_get."),
    },
  },
  {
    name: "pricing_get",
    method: "GET",
    path: "/pricing",
    write: false,
    auth: false,
    description:
      "The live price list: funding records (price per record and free records a month), research (whether it is " +
      "available and its price per brief) and watchlist deliveries. Free, needs no key. Use it to quote a cost before a large call.",
    shape: {},
  },
  {
    name: "api_version",
    method: "GET",
    path: "/v1/version",
    write: false,
    auth: false,
    description: "The API's version and deployed build. Free, needs no key.",
    shape: {},
  },
];

export function buildQuery(args) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args || {})) {
    if (v !== undefined && v !== null && String(v).length > 0) qs.set(k, String(v));
  }
  return qs.toString();
}

export function buildPath(template, args) {
  const used = new Set();
  const path = String(template).replace(/\{(\w+)\}/g, (_, k) => {
    used.add(k);
    const v = args?.[k];
    return encodeURIComponent(v == null ? "" : String(v));
  });
  const rest = {};
  for (const [k, v] of Object.entries(args || {})) if (!used.has(k)) rest[k] = v;
  return { path, rest };
}

/** Full request URL for a tool call. A `body` tool sends no query string. */
export function buildUrl(baseUrl, tool, args) {
  const { path, rest } = buildPath(tool.path, args);
  for (const [k, fmt] of Object.entries(tool.format || {})) {
    if (rest[k] !== undefined && rest[k] !== null) rest[k] = fmt(rest[k]);
  }
  const q = tool.body ? "" : buildQuery(rest);
  return `${String(baseUrl).replace(/\/+$/, "")}${path}${q ? `?${q}` : ""}`;
}

/** The JSON body for a `body` tool (null for every other tool): the arguments not used in the path, empty ones dropped. */
export function buildBody(tool, args) {
  if (!tool.body) return null;
  const { rest } = buildPath(tool.path, args);
  const out = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.length === 0)) out[k] = v;
  }
  return JSON.stringify(out);
}
