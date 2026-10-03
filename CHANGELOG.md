# Changelog

All notable changes to `prospectapis-mcp` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), independently of the API's version.

## [Unreleased]

### Changed

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
