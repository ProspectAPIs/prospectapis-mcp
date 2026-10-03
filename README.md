# prospectapis-mcp

MCP server for the ProspectAPIs funding data and research API. It gives an MCP client (Claude Desktop, Claude
Code, Cursor and others) fourteen tools over `https://api.prospectapis.com`, one per customer endpoint (the
liveness probe `GET /health` has none; `api_version` answers the same question). Five tools change state:
`research_submit` (starts a paid research job), `watchlist_create`, `watchlist_test`, `watchlist_delete` and
`feedback_send`; every other tool only reads.

| Tool | Endpoint | Cost |
|---|---|---|
| `funding_search` | `GET /v1/funding` | $0.02 per record returned, after 100 free records a month; no match is free |
| `funding_get` | `GET /v1/funding/:id` | $0.02 when found; a missing id is free |
| `research_submit` | `POST /v1/research` | one research at `research_price_usd` (see `account_balance`), charged only when the brief completes; refunded on failure |
| `research_get` | `GET /v1/research/:id` | free; poll until `status` is `completed` or `failed` |
| `watchlist_create`, `watchlist_list`, `watchlist_get`, `watchlist_deliveries`, `watchlist_test`, `watchlist_delete` | `/v1/watchlists` | free to manage; a delivered event costs one record, only when your webhook answers 2xx |
| `account_balance` | `GET /v1/account` | free |
| `feedback_send` | `POST /v1/feedback` | free; reports a bug, wrong field or missing capability to the team (10 an hour per key) |
| `pricing_get` | `GET /pricing` | free, no key needed; the live price list |
| `api_version` | `GET /v1/version` | free, no key needed |

`funding_search` filters: `since`, `until` (YYYY-MM-DD), `round` (comma list such as `seed,series_a`),
`min_amount_usd`, `max_amount_usd`, `company`, `domain`, `investor`, `country`, `limit` (1 to 100) and
`cursor` (the previous page's `next_cursor`, passed back unchanged).

`research_submit` takes exactly one prospect identifier (`domain`, `website_url`, `company_name`,
`company_linkedin_url`, a work `email` or `linkedin_url`), or `person_name` with `company_name`, plus an optional
`context` (your own product, at most 1,000 characters) and `purpose` (`account_research`, `pre_call` or
`outreach`). It returns a `research_id` at once; a brief takes 20 to 90 seconds.

## Configure

| Variable | Required | Default |
|---|---|---|
| `PROSPECTAPIS_API_KEY` | yes (all tools except `pricing_get` and `api_version`) | none |
| `PROSPECTAPIS_BASE_URL` | no | `https://api.prospectapis.com` |

Client config (for example `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prospectapis": {
      "command": "npx",
      "args": ["-y", "prospectapis-mcp"],
      "env": { "PROSPECTAPIS_API_KEY": "pa_live_..." }
    }
  }
}
```

Claude Code: `claude mcp add prospectapis -e PROSPECTAPIS_API_KEY=pa_live_... -- npx -y prospectapis-mcp`.

## Develop

```bash
cd mcp
npm install
npm test        # mocked fetch over an in-memory MCP transport, no network
npm run check
```

The package is versioned independently of the API (SemVer, `CHANGELOG.md` in this folder). It is marked
`private` so it cannot be published by accident; publishing is done only from the product's own npm identity.
