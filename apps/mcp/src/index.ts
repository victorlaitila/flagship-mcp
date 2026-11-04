import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { FlagshipApi } from './api.js';
import { createServer } from './tools.js';

// stdout carries MCP protocol messages only; all diagnostics go to stderr.
const apiUrl = (process.env.FLAGSHIP_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const actorId = process.env.FLAGSHIP_ACTOR_ID ?? 'claude-code';

const server = createServer(new FlagshipApi(apiUrl, actorId));
await server.connect(new StdioServerTransport());
console.error(`[flagship-mcp] ready (api: ${apiUrl}, identity: ${actorId})`);
