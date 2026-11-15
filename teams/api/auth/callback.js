// Vercel-Funktion, Logik in ../../lib/auth.js. Anmeldungen für den Claude-Connector (state „mcp.…“) gehen an ../../lib/mcp.js
import { callback } from '../../lib/auth.js';
import { isMcpCallback, mcpCallback } from '../../lib/mcp.js';
export default (req, res) => isMcpCallback(req) ? mcpCallback(req, res) : callback(req, res);
