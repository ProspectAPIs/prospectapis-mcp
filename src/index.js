#!/usr/bin/env node
// stdio entry point. Configuration comes from the MCP client's environment:
//   PROSPECTAPIS_API_KEY    required for every tool except api_version
//   PROSPECTAPIS_BASE_URL   optional, default https://api.prospectapis.com
// Logs go to stderr: stdout is the protocol channel.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS } from "./tools.js";
import { createServer, DEFAULT_BASE_URL } from "./server.js";

const API_KEY = process.env.PROSPECTAPIS_API_KEY;
const BASE_URL = process.env.PROSPECTAPIS_BASE_URL || DEFAULT_BASE_URL;

if (!API_KEY) {
  console.error(
    "[prospectapis-mcp] PROSPECTAPIS_API_KEY is not set. Tools are registered, but every call except api_version will fail until it is.",
  );
}

async function main() {
  const { server, baseUrl } = createServer({ apiKey: API_KEY, baseUrl: BASE_URL });
  await server.connect(new StdioServerTransport());
  console.error(`[prospectapis-mcp] ready, ${TOOLS.length} tools, base ${baseUrl}`);
}

main().catch((err) => {
  console.error("[prospectapis-mcp] fatal:", err);
  process.exit(1);
});
