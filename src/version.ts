/**
 * Server identity constants.
 * SERVER_VERSION follows SemVer; bumped per release.
 * PROTOCOL_VERSION is the MCP protocol revision this server targets.
 */

export const SERVER_NAME = 'da-mcp' as const
export const SERVER_VERSION = '0.1.12' as const
export const PROTOCOL_VERSION = '2026-07-28' as const

export type ServerVersion = typeof SERVER_VERSION
export type ProtocolVersion = typeof PROTOCOL_VERSION
