# Changelog

All notable changes to `prospectapis-mcp` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), independently of the API's version.

## [Unreleased]

## [0.4.2] - 2026-10-29

### Changed

- `server.json` lists the hosted endpoint `https://api.prospectapis.com/mcp` under `remotes` again. It moved here from
  the earlier `io.github.ProspectAPIs/prospectapis-mcp` entry, which is retired in favour of this one (its 0.2.4
  version, the one that listed the endpoint, is deleted from the registry). No code change; the tools, inputs and
  outputs are the same as 0.4.1.

## [0.4.1] - 2026-10-26

### Changed

- The Official MCP Registry name is now `com.prospectapis/prospectapis-mcp` (`mcpName` in `package.json` and `name` in
  `server.json`), proved by a DNS record on prospectapis.com instead of a GitHub sign-in. No code change; the tools,
  inputs and outputs are the same as 0.4.0.
- `server.json` no longer lists the hosted endpoint under `remotes`: the registry keeps each remote URL on one entry,
  and `https://api.prospectapis.com/mcp` is already listed on the earlier `io.github.ProspectAPIs/prospectapis-mcp`
  entry, which stays live. This entry lists the npm package.

## [0.4.0] - 2026-10-25

### Added

- `email_verify_stats` and `email_outcomes_report`: your verification mix, and bounced or delivered reports (a charged valid you report bounced within 30 days is credited back).
- `email_verify_job_create`, `email_verify_job_get`, `email_verify_job_results`, `email_verify_job_stop`: bulk verification jobs of up to 50,000 addresses with free retries for slow servers, list sampling (`sample`) and list monitoring (`monitor_days`).
- `email_find`: a person's work address from name and domain, $0.02 only when found.
- `email_domain_check`: what DNS and our recent checks know about a domain, free.
- `email_verify_calibration`: measured bounce rate per score band, free.
- `email_clean_list`: sort up to 1,000 addresses into keep, review and remove with quick checks.
- `email_verify` takes `depth: "quick"` ($0.001 per address, no mail server contacted). Twenty-five tools.

## [0.3.0] - 2026-10-25

### Added

- `email_verify` (`POST /v1/email/verify`): check 1 to 25 email addresses for deliverability. Each result carries `status` (valid, invalid, catch-all or unknown), `reason`, `charged`, `flags`, `smtp_code` and `catch_all_tier`. A valid or invalid result costs $0.004; catch-all and unknown results are free. When the balance covers only some addresses, the rest come back `unknown` with reason `not_checked_insufficient_credits`, free. Fifteen tools.

### Changed

- Pricing: every account starts with a free $1 balance (no card, no monthly reset) that each paid call draws from at its own price. The 100 free funding records a month are gone, so tool descriptions, the server instructions, the playbooks and the README no longer promise them. Watchlist deliveries cost $0.02 per delivered record from the balance.
- `pricing_get` and `account_balance` descriptions name the new fields (the signup balance, the email verification price and which statuses are charged).
- The 402 hint reads "out of credits for this call".

## [0.2.5] - 2026-10-20

### Added

- Four playbooks, served as MCP resources (resources/list, resources/read) and as one prompt each (prompts/list, prompts/get), so a client can offer them as slash commands: newly funded prospects, pre-call brief, funding alerts to a webhook, and an investor's recent rounds. A prompt hands its playbook over as an embedded resource, so the recipe matches what resources/read serves, and a client that omits the optional `arguments` still gets it. Tests hold every name a playbook uses to the tool catalog.

### Changed

- The README's first sentence now names the product URL (https://prospectapis.com) and who it is for, because directory cards and search snippets copy that sentence alone and were linking GitHub only. A test pins both.
- Added CODE_OF_CONDUCT.md (Contributor Covenant 2.1), which open-source programs ask for.

## [0.2.4] - unreleased

### Fixed

- Every tool has a human title ("Search Funding Rounds", "Delete Watchlist"), sent as both the tool's `title` and `annotations.title`; before, the title was the raw tool name.
- `watchlist_delete` now says `destructiveHint: true` (it removes the watchlist and its delivery history), so a client asks before running it; it said `false`, like every other tool. The other writes stay non-destructive: they only add a research job, a watchlist, a test event or a report.
- `idempotentHint` is set where it is true: the free reads and `watchlist_delete`. `funding_search` and `funding_get` stay `false`, because every call that returns records is billed again. `openWorldHint` stays `true` on every tool.
- One factory, `annotationsFor()` in `src/tools.js`, builds these annotations for the npm server and the hosted MCP door alike. `test/annotations.test.js` checks every served tool (a title that is not the raw name and has no underscore, every `*_delete` tool destructive and not read-only) and plants each regression to prove the check fails on it.

- README opening rewritten for the listings that copy it word for word (Glama, mcpservers.org, the MCP Registry, npm): one paragraph on what the server does and costs, then the install lines and the website, plus a three-question FAQ. No tool or behaviour change; 14 tools.
- `package-lock.json` carries the package version again (it still said 0.2.2).
- `test/readme-opening.test.js` checks the opening against the package name, its Website line against `server.json` `websiteUrl`, every tool count the README states against `src/tools.js`, the stated Node floor against `engines`, and one version across `package.json`, `server.json` and `package-lock.json`.
- The README no longer says every funding record carries its announcement URL: some records come back without one, so the opening and the FAQ now say records carry the public announcement URL when there is one, and `test/readme-opening.test.js` fails on any sentence that promises a URL on every record.
- `test/package-scripts.test.js` checks that every file an npm script runs exists in the checkout.

## [0.2.3] - 2026-10-11

### Added

- `server.json` (the Official MCP Registry manifest) and the matching `mcpName` field in `package.json`, both `io.github.ProspectAPIs/prospectapis-mcp`, so the server can be listed on registry.modelcontextprotocol.io (which PulseMCP ingests). No tool or behaviour change.
- `scripts/registry-drift.mjs` with `npm run check:registry-drift` and a `postpublish` hook, so every npm release also updates the registry entry and a drift between npm, `server.json` and the registry fails the check.

## [0.2.2] - 2026-10-03

### Changed

- `research_submit` and `research_get` describe the brief's new `social` section: the company's X account and Reddit mentions, each value cited, absent when nothing was found.

- Tests that compare the tool schemas with the API source moved to `test/api-parity.test.js`, which runs only where that source is present; the rest of the suite runs in a standalone checkout. `npm publish` now runs the tests first (`prepublishOnly`).

## [0.2.1] - 2026-10-03

### Added

- `repository` and `bugs` in package.json, pointing at the public source repository github.com/ProspectAPIs/prospectapis-mcp. No code change.

## [0.2.0] - 2026-10-02

First release published to npm (0.1.0 was never published).

### Changed

- Licensed MIT; `private` removed; homepage https://prospectapis.com/mcp. The README configures the server
  with `npx -y prospectapis-mcp`.

### Added

- `watchlist_create`, `watchlist_list`, `watchlist_deliveries`, `watchlist_test` and `watchlist_delete`
  (`/v1/watchlists`) create funding watchlists that post matching rounds to your webhook, list them, read their
  delivery log, send a test delivery and delete them.
- `feedback_send` (`POST /v1/feedback`) reports a bug, a wrong field or a missing capability to the team.
- `watchlist_get` (`GET /v1/watchlists/:id`) reads one watchlist, without its secret, so every watchlist route has a
  tool.
- `pricing_get` (`GET /pricing`, no key) returns the live price list, so an agent can quote a cost before a call.
- `research_submit` (`POST /v1/research`, the arguments sent as a JSON body) starts a prospect research brief and
  returns its `research_id`; `research_get` (`GET /v1/research/:id`) polls it. `research_submit` is the package's
  first tool that is not read-only, and its `purpose` is `account_research`, `pre_call` or `outreach`.
- A `503` from the API carries a hint, for research that is not priced yet.

### Fixed

- `funding_search` bounds `min_amount_usd` and `max_amount_usd` (0 to 999999999999999) and sends them as
  fixed decimals with at most 4 places, so a float such as `0.1 + 0.2` no longer reaches the API as a value it
  rejects.

## [0.1.0] - 2026-10-01

### Added

- stdio MCP server built on `@modelcontextprotocol/sdk`, configured by `PROSPECTAPIS_API_KEY` and
  `PROSPECTAPIS_BASE_URL` (default `https://api.prospectapis.com`).
- `funding_search` (`GET /v1/funding`, every filter plus cursor paging), `funding_get`
  (`GET /v1/funding/:id`), `account_balance` (`GET /v1/account`) and `api_version` (`GET /v1/version`), all
  read-only.
- API errors reach the model with the HTTP status, a short hint and the API's own body, so a rejected
  filter is named and a 402 carries its top-up link.
- `createServer` exported from `prospectapis-mcp/server` for hosts that supply their own fetch or auth.
