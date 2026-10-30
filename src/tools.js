// Tool catalog and pure request builders. Kept apart from the server wiring so
// the catalog is unit-tested without a transport or a network.
//
// One tool per REST endpoint. Each entry is { name, path, method, shape, write }:
//   - `shape` is the zod input schema; its keys map 1:1 to query parameters,
//     except `{name}` placeholders in `path`, which are interpolated into the
//     URL and removed from the query string;
//   - `body: true` sends the arguments as a JSON body instead of a query
//     string (research_submit and email_verify, POSTs);
//   - `write: true` marks a tool that changes state or spends credits
//     (research_submit starts a paid job, email_verify spends credits); the server turns `write` into MCP's
//     readOnlyHint, so every other tool is read-only;
//   - `auth: false` marks the tools the API serves without a key (pricing_get, api_version);
//   - `title` is the human name a client shows instead of the raw tool name;
//   - `idempotent: true` marks a tool whose repeat call with the same arguments changes nothing more: the free
//     reads, and watchlist_delete (a second delete finds nothing to delete). funding_search and funding_get are
//     read-only but NOT idempotent, because every call that returns records is billed again.
// annotationsFor() below turns these fields into MCP tool annotations; the npm server and the hosted door
// (apps/api/src/lib/mcp-door.js, through createServer) both register every tool with it, so they cannot drift.

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
    title: "Search Funding Rounds",
    write: false,
    format: { min_amount_usd: formatAmount, max_amount_usd: formatAmount },
    description:
      "Search funding rounds (venture rounds, debt, grants, IPOs), newest announcement first. Costs $0.02 per record returned, drawn from your balance (every account starts with a free $1); a search that matches nothing is free. " +
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
      country: z.string().min(1).max(60).optional().describe("Headquarters country as a name or ISO code, such as US, United States or DE. Other text, such as a city, matches the stated location."),
      limit: z.number().int().min(1).max(100).optional().describe("Records per page, 1 to 100 (default 25). Each record returned is billed."),
      cursor: z.string().max(200).optional().describe("Opaque cursor from the previous page's `next_cursor`."),
    },
  },
  {
    name: "funding_get",
    method: "GET",
    path: "/v1/funding/{id}",
    title: "Get Funding Round",
    write: false,
    description: "Read one funding record by id. Costs $0.02 when found; a missing id is free.",
    shape: {
      id: z.string().uuid().describe("The funding record id from a `funding_search` result."),
    },
  },
  {
    name: "research_submit",
    method: "POST",
    path: "/v1/research",
    title: "Start Prospect Research",
    write: true,
    body: true,
    description:
      "Start a cited pre-call research brief on one prospect: company, funding, traction, competitors, news, people, risks, regions, " +
      "social (their X account and Reddit mentions, when found), " +
      "plus a `fit` section when you pass `context`. Give exactly ONE identifier (domain, website_url, company_name, company_linkedin_url, " +
      "a work email, or linkedin_url), or person_name together with company_name. Returns `research_id` at once; the brief takes 20 to 90 seconds, " +
      "so poll research_get every 10 to 15 seconds until `status` is `completed` or `failed`. " +
      "Costs one research at the price account_balance reports as `research_price_usd`, held when you submit, charged only when the brief " +
      "completes and refunded in full if it fails.",
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
    title: "Get Research Brief",
    idempotent: true,
    write: false,
    description:
      "Read a research job by the `research_id` research_submit returned: `status` (queued, running, completed, failed), `input`, " +
      "`result` (the brief, once completed) and `error` (once failed). Every brief field is {value, sources, confidence}. " +
      "`result.social` holds `x` (handle, followers, bio, posting_cadence, recent_topics, notable_posts) and `reddit` " +
      "(mention_count_90d, top_threads, communities, tone, tone_basis); a platform with nothing found is absent, and with " +
      "neither `social` is absent. Free; only your own account's jobs are visible.",
    shape: {
      id: z.string().uuid().describe("The `research_id` from research_submit."),
    },
  },
  {
    name: "email_verify",
    method: "POST",
    path: "/v1/email/verify",
    title: "Verify Email Addresses",
    write: true,
    body: true,
    description:
      "Check whether 1 to 25 email addresses can receive mail. Each result has `status` (valid, invalid, catch-all or unknown), " +
      "`reason`, `reason_text`, `score` (0 to 100), `recommendation` (send, send_with_caution, retry_later or do_not_send), `charged`, `flags`, `smtp_code`, `catch_all_tier`, `did_you_mean` (a likely domain typo), `mail_provider` and `checked_at`. Costs $0.004 per valid or invalid result, drawn from your " +
      "balance; catch-all and unknown results are free (pricing_get lists which statuses are charged). When the balance covers only " +
      "some addresses, the rest come back `unknown` with reason `not_checked_insufficient_credits`, free. " +
      "`depth: \"quick\"` never contacts the mail server: syntax, disposable and free lists, DNS, parked and new-domain flags " +
      "and a recently measured catch-all verdict, at $0.001 per address whatever the status; an address that needs a mailbox " +
      "check comes back `unknown` with reason `not_probed`.",
    shape: {
      depth: z.enum(["full", "quick"]).optional().describe("full (default) checks the mailbox; quick is DNS and lists only, $0.001 per address."),
      emails: z
        .array(z.union([
          z.string().min(3).max(254),
          z.object({ email: z.string().min(3).max(254), first_name: z.string().max(80).optional(), last_name: z.string().max(80).optional() }),
        ]))
        .min(1)
        .max(25)
        .describe("The addresses to check, 1 to 25 per call. An item may be {email, first_name, last_name} to also check the address against the person's name."),
    },
  },
  {
    name: "email_domain_check",
    method: "GET",
    path: "/v1/email/domain/{domain}",
    title: "Check Email Domain",
    idempotent: true,
    write: false,
    description:
      "What is known about one email domain without contacting its mail server: `exists`, `accepts_mail`, `null_mx`, `mx` hosts, " +
      "`mail_provider`, `spf`, `dmarc`, `disposable`, `free_provider`, `parked`, `domain_age_days`, `new_domain`, `did_you_mean`, " +
      "and `catch_all` (true or false only when our own check measured it recently, else null) with `catch_all_checked_at`. " +
      "Free, up to 300 lookups an hour per account.",
    shape: { domain: z.string().min(3).max(253).describe("A domain name such as example.com.") },
  },
  {
    name: "email_find",
    method: "POST",
    path: "/v1/email/find",
    title: "Find Email Address",
    write: true,
    body: true,
    description:
      "Find a person's work email from `first_name`, `last_name` and company `domain`. The common patterns are checked in order " +
      "against the mail server, most common first. Returns `status` (found, catch_all, unknown, not_found), `email`, `pattern`, " +
      "`score`, `recommendation` and the addresses `checked`. Costs $0.02 only when an address is found; on a catch-all domain " +
      "it returns the most likely address as `best_guess`, free.",
    shape: {
      first_name: z.string().min(1).max(80).describe("The person's first name."),
      last_name: z.string().max(80).optional().describe("The person's last name."),
      domain: z.string().min(3).max(253).describe("The company's email domain, such as example.com."),
    },
  },
  {
    name: "email_verify_calibration",
    method: "GET",
    path: "/v1/email/verify/calibration",
    title: "Email Score Calibration",
    idempotent: true,
    write: false,
    description:
      "What each verification score band has meant in practice: the measured bounce rate per band from delivery outcomes " +
      "customers reported over the last 90 days. A band with fewer than 30 reports shows a null rate. Free.",
    shape: {},
  },
  {
    name: "email_clean_list",
    method: "POST",
    path: "/v1/email/clean",
    title: "Clean Email List",
    write: true,
    body: true,
    description:
      "Clean a list of up to 1,000 addresses in one call with quick checks (no mail server is contacted): returns `keep`, " +
      "`review` (role, free, parked, new or typo addresses, with a reason) and `remove` (cannot receive mail), plus `counts`. " +
      "$0.001 per well-formed address. Run email_verify on the kept addresses you will actually send to.",
    shape: {
      emails: z.array(z.string().min(3).max(254)).min(1).max(1000).describe("The addresses to clean, 1 to 1,000."),
    },
  },
  {
    name: "email_verify_stats",
    method: "GET",
    path: "/v1/email/verify/stats",
    title: "Email Verification Stats",
    write: false,
    description:
      "Your own email verification mix over the last `days` (1 to 90, default 30): `total`, `by_status` (valid, invalid, " +
      "catch-all, unknown), `charged`, `served_from_cache`, `catch_all_share` and `unknown_share`. Free.",
    shape: {
      days: z.number().int().min(1).max(90).optional().describe("Window in days, 1 to 90 (default 30)."),
    },
  },
  {
    name: "email_outcomes_report",
    method: "POST",
    path: "/v1/email/outcomes",
    title: "Report Email Outcomes",
    write: true,
    body: true,
    description:
      "Report what happened when you sent: `bounced` or `delivered`, 1 to 100 addresses per call. A bounce you report makes " +
      "your later email_verify checks of that address come back invalid (reason `reported_bounce`); a delivered report on a " +
      "catch-all address raises its score. Returns `stored`. Free.",
    shape: {
      outcomes: z
        .array(z.object({ email: z.string().min(3).max(254), outcome: z.enum(["bounced", "delivered"]) }))
        .min(1)
        .max(100)
        .describe("Each address and what happened when you sent to it."),
    },
  },
  {
    name: "email_verify_job_create",
    method: "POST",
    path: "/v1/email/verify/jobs",
    title: "Start Email Verification Job",
    write: true,
    body: true,
    description:
      "Check up to 50,000 addresses in the background. Returns 202 with a job `id`; poll email_verify_job_get. A slow or " +
      "greylisting server is retried about 5, 15 and 30 minutes later, free. Each valid or invalid result costs $0.004 as " +
      "it is checked; catch-all and unknown are free. An optional https `callback_url` gets one signed POST when the job " +
      "completes (verify with the returned `secret`). At most 5 jobs run at once per account.",
    shape: {
      sample: z.number().int().min(10).max(50000).optional().describe("Check only a random sample of this many addresses; the job then reports estimated shares for the whole list."),
      monitor_days: z.number().int().min(7).max(90).optional().describe("Check the whole list again this many days after each run, billing each definite result again; the callback reports what changed."),
      emails: z.array(z.string().min(1).max(254)).min(1).max(50000).describe("The addresses, 1 to 50,000."),
      callback_url: z.string().url().max(2048).optional().describe("An https URL to POST to when the job completes."),
    },
  },
  {
    name: "email_verify_job_get",
    method: "GET",
    path: "/v1/email/verify/jobs/:id",
    title: "Get Email Verification Job",
    write: false,
    description: "A job's `status` (queued, running, completed), `total`, `done`, `charged_count` and `amount_usd`. Free.",
    shape: { id: z.string().uuid().describe("The job `id` from email_verify_job_create.") },
  },
  {
    name: "email_verify_job_results",
    method: "GET",
    path: "/v1/email/verify/jobs/:id/results",
    title: "Get Email Verification Job Results",
    write: false,
    description:
      "A job's results in input order, up to 1,000 a page (`limit`), from `cursor`; `next_cursor` is null on the last page. " +
      "An address not yet checked shows status `pending`. Free.",
    shape: {
      id: z.string().uuid().describe("The job `id`."),
      cursor: z.number().int().min(0).optional().describe("Start at this position (0-based)."),
      limit: z.number().int().min(1).max(1000).optional().describe("Results per page, 1 to 1,000 (default 1,000)."),
    },
  },
  {
    name: "email_verify_job_stop",
    method: "POST",
    path: "/v1/email/verify/jobs/{id}/stop",
    title: "Stop Verification Job",
    body: true,
    write: true,
    description: "Turn off a job's monitoring (its regular re-checks); a job still running is cancelled, and what it already checked stays readable. Free.",
    shape: { id: z.string().uuid().describe("The job id.") },
  },
  {
    name: "watchlist_create",
    method: "POST",
    path: "/v1/watchlists",
    title: "Create Funding Watchlist",
    body: true,
    write: true,
    description:
      "Save a funding-signal alert: a set of funding_search filters plus an https webhook. Each NEW funding event that " +
      "matches is POSTed to the webhook, signed with the returned `secret` (header Prospect-Signature: t=..,v1=HMAC-SHA256). " +
      "Creating is free; each delivered event costs one record ($0.02), charged only when the webhook " +
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
    title: "List Watchlists",
    idempotent: true,
    write: false,
    description: "Your funding-signal alerts (without their secrets). Free.",
    shape: {},
  },
  {
    name: "watchlist_get",
    method: "GET",
    path: "/v1/watchlists/{id}",
    title: "Get Watchlist",
    idempotent: true,
    write: false,
    description: "One funding-signal alert: its name, filters, webhook URL, whether it is active and why it was paused (never its secret). Free.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "watchlist_deliveries",
    method: "GET",
    path: "/v1/watchlists/{id}/deliveries",
    title: "List Watchlist Deliveries",
    idempotent: true,
    write: false,
    description: "The last 50 deliveries of one alert and their outcome (delivered, retry, failed, no_credit). Free.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "watchlist_test",
    method: "POST",
    path: "/v1/watchlists/{id}/test",
    title: "Send Watchlist Test Event",
    body: true,
    write: true,
    description: "Send a signed sample event to the alert's webhook now, to build and verify the receiver. Free; 5 a minute.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "watchlist_delete",
    method: "DELETE",
    path: "/v1/watchlists/{id}",
    title: "Delete Watchlist",
    idempotent: true,
    write: true,
    description: "Delete a funding-signal alert and its delivery history. Free.",
    shape: { id: z.string().uuid().describe("The watchlist id.") },
  },
  {
    name: "account_balance",
    method: "GET",
    path: "/v1/account",
    title: "Get Account Balance",
    idempotent: true,
    write: false,
    description: "Your credit balance and the prices you pay (record, research, email verification). Free. Check it before a large paged search.",
    shape: {},
  },
  {
    name: "feedback_send",
    method: "POST",
    path: "/v1/feedback",
    title: "Send Feedback",
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
    title: "Get Pricing",
    idempotent: true,
    write: false,
    auth: false,
    description:
      "The live price list: the balance a new account starts with, funding records (price per record), research (whether it is " +
      "available and its price per brief), email verification (price per check, which statuses are charged and which are free) " +
      "and watchlist deliveries. Free, needs no key. Use it to quote a cost before a large call.",
    shape: {},
  },
  {
    name: "api_version",
    method: "GET",
    path: "/v1/version",
    title: "Get API Version",
    idempotent: true,
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

// The one place a catalog entry becomes MCP tool annotations. A tool is destructive when it is a write whose
// method is DELETE (watchlist_delete removes the watchlist and its delivery history); every other write only adds
// (a research job, a watchlist, a test event, a report), so it is a write that is not destructive.
export function annotationsFor(tool) {
  const write = !!tool.write;
  return {
    title: tool.title,
    readOnlyHint: !write,
    destructiveHint: write && tool.method === "DELETE",
    idempotentHint: !!tool.idempotent,
    openWorldHint: true,
  };
}
