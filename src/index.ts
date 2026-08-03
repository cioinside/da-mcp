/**
 * Public API re-exports for da-mcp.
 * The MCP server entrypoint is src/server.ts and is not re-exported here.
 */

export * from './version.js'
export { runServer, createMcpServer } from './server.js'
