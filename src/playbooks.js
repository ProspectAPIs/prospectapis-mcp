// Playbooks: short recipes an agent runs with the tools in src/tools.js, served over the MCP RESOURCE primitive
// (resources/list, resources/read) and offered as one PROMPT each (prompts/list, prompts/get), so a client can show
// them as slash commands.
//
// WHY RESOURCES AND PROMPTS, NOT TOOLS. Every tool in src/tools.js is one REST endpoint (test/api-parity.test.js
// holds the catalog to the API). A recipe wraps no endpoint; it is read-only context an agent fetches when it needs
// it, which is what resources are for, and a prompt is how a client offers that recipe to a user.
//
// A DESCRIPTION IS LISTED, A BODY IS FETCHED. Clients show the title and description beside every tool, so those
// state what the recipe does in plain product terms and never instruct the model. The body is returned only for a
// URI or prompt the caller asked for by name, so it names tools freely.
//
// Every figure in a body (prices, page size, alert limit, poll interval) is the one the tool descriptions in
// src/tools.js state, checked by review, not by a test. test/playbooks.test.js fails if a body names a tool,
// parameter, value or response field the catalog does not have.

export const PLAYBOOK_MIME = "text/markdown";

const NEWLY_FUNDED = `# Newly funded prospects

Build a short list of companies that just raised, worth reaching out to while the round is fresh.

1. \`account_balance\` first. Each funding record returned costs $0.02, drawn from your balance (a new account starts
   with $1, about 50 records), so know what is left before you pull pages.
2. \`funding_search\` with a tight window and the filters that describe the buyer: \`since\` (for example the last 30
   days), \`round\` (such as \`seed,series_a\`), \`country\`, and \`min_amount_usd\` or \`max_amount_usd\`. Start with
   \`limit\` 10 to 25. A search that matches nothing costs nothing, so narrow before you widen.
3. Read the results. Each record has the company, its domain, the round, the amount, the investors and, when there is
   one, the URL of the public announcement. Drop companies without a domain or outside the buyer profile.
4. Page with \`cursor\` only if the first page is all good fits; pass \`next_cursor\` back exactly as returned. A null
   \`next_cursor\` means there are no more matches.
5. For the two or three best fits, run the pre-call brief playbook (\`research_submit\` with \`domain\`).
6. Present the list as company, domain, round, amount, date, lead investors and the announcement URL where there is
   one, so every line can be checked.
`;

const PRE_CALL_BRIEF = `# Pre-call brief

A cited brief on one company or person before a call or a first email.

1. \`research_submit\` with exactly ONE identifier: \`domain\` is best; otherwise \`website_url\`, \`company_name\`, a work
   \`email\`, or \`person_name\` together with \`company_name\`. Set \`purpose\` to \`pre_call\` for objections and discovery
   questions, or \`outreach\` for sourced hooks with draft first lines. Add \`context\` (your own product, up to 1,000
   characters) to get a \`fit\` section.
2. It returns \`research_id\` at once. The brief takes 20 to 90 seconds: call \`research_get\` with that id every 10 to 15
   seconds until \`status\` is \`completed\` or \`failed\`. Polling is free.
3. A brief is charged only when it completes, at the \`research_price_usd\` that \`account_balance\` reports, and refunded
   in full if it fails.
4. Every field in \`result\` is \`{value, sources, confidence}\`. Quote the sources with the claims you use, and say when
   a field came back empty rather than filling the gap.
`;

const FUNDING_ALERTS = `# Funding alerts to a webhook

Get every new funding round that matches a profile pushed to your own endpoint, instead of searching again.

1. Decide the filters with \`funding_search\` first (\`round\`, \`country\`, \`min_amount_usd\`, \`max_amount_usd\`,
   \`investor\`, \`company\` or \`domain\`), and check the results look right. Date windows and paging do not apply to an
   alert.
2. \`watchlist_create\` with a \`name\`, those \`filters\` and an https \`webhook_url\` on a public host. Save the \`secret\`
   it returns: it is shown once, and every delivery is signed with it in the Prospect-Signature header
   (t=..,v1=HMAC-SHA256). Creating is free; each delivered event costs one record, charged only when your webhook
   answers 2xx. An account can have 20 active alerts.
3. \`watchlist_test\` sends a signed sample event now, so the receiver can be built and checked before a real round
   arrives. Free, 5 a minute.
4. Later, \`watchlist_deliveries\` shows the last 50 deliveries and their outcome (delivered, retry, failed,
   no_credit), and \`watchlist_get\` shows whether the alert is active and why it was paused.
`;

const INVESTOR_ROUNDS = `# An investor's recent rounds

See which companies an investor has backed lately, to find warm introductions or a portfolio to sell into.

1. \`funding_search\` with \`investor\` set to the investor's exact name (case-insensitive) and a \`since\` date, newest
   first. Add \`round\` to keep to one stage.
2. Each record lists every investor named and the lead investors, so you can tell a lead from a participation.
3. Group the results by round and by country, and give the announcement URL with each line that has one.
4. To follow this investor from now on, run the funding alerts playbook with \`investor\` as the filter.
`;

export const PLAYBOOKS = Object.freeze([
  {
    name: "newly-funded-prospects",
    uri: "prospectapis://playbooks/newly-funded-prospects",
    title: "Newly funded prospects",
    description: "Build a short list of companies that raised recently, filtered by round, country and amount, with the announcement for each.",
    text: NEWLY_FUNDED,
    prompt: { arg: "profile", describe: "Who you sell to, for example 'seed and Series A fintech in the US'.", ask: (v) => `Run this playbook for: ${v}` },
  },
  {
    name: "pre-call-brief",
    uri: "prospectapis://playbooks/pre-call-brief",
    title: "Pre-call brief",
    description: "A cited research brief on one company or person before a call or a first email.",
    text: PRE_CALL_BRIEF,
    prompt: { arg: "prospect", describe: "The company domain, company name, or person and company.", ask: (v) => `Run this playbook for: ${v}` },
  },
  {
    name: "funding-alerts",
    uri: "prospectapis://playbooks/funding-alerts",
    title: "Funding alerts to a webhook",
    description: "Push every new funding round that matches a profile to your own https endpoint, signed, instead of searching again.",
    text: FUNDING_ALERTS,
  },
  {
    name: "investor-rounds",
    uri: "prospectapis://playbooks/investor-rounds",
    title: "An investor's recent rounds",
    description: "The companies one investor has backed lately, split into lead and participation, with sources.",
    text: INVESTOR_ROUNDS,
    prompt: { arg: "investor", describe: "The investor's name, for example 'Example Ventures'.", ask: (v) => `Run this playbook for: ${v}` },
  },
]);
