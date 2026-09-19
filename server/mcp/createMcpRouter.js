const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpAuthMiddleware } = require('./auth');
const { createFlopsMcpServer } = require('./createMcpServer');

/**
 * Stateless Streamable HTTP MCP mounted at /mcp.
 * Auth: Authorization Bearer MCP_API_TOKEN (see auth.js).
 */
function createMcpRouter(db) {
  const router = express.Router();
  const mcpAuth = createMcpAuthMiddleware(db);

  router.use(mcpAuth);

  router.post('/', async (req, res) => {
    const server = createFlopsMcpServer(db, req.mcpUserId);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (err) {
      console.error('[mcp] request error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode: no SSE session GET/DELETE
  router.get('/', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  router.delete('/', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  return router;
}

module.exports = { createMcpRouter };
