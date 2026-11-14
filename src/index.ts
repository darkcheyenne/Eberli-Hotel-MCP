#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { type AppConfig, type Logger, createLogger, loadConfig } from "./config.js";
import { SERVER_NAME, SERVER_VERSION, createTravelMcpServer } from "./server.js";
import { TtlCache } from "./utils/cache.js";

interface CliOverrides {
  transport?: "stdio" | "http";
  host?: string;
  port?: number;
}

function parseCliArgs(argv: string[]): CliOverrides {
  const overrides: CliOverrides = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--transport" || arg === "-t") && (next === "stdio" || next === "http")) {
      overrides.transport = next;
      i += 1;
    } else if (arg === "--host" && next) {
      overrides.host = next;
      i += 1;
    } else if ((arg === "--port" || arg === "-p") && next && /^\d+$/.test(next)) {
      overrides.port = Number(next);
      i += 1;
    }
  }
  return overrides;
}

interface ActiveHttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export async function startStdioServer(config: AppConfig, logger: Logger): Promise<void> {
  const { server } = createTravelMcpServer({ config, logger });
  const transport = new StdioServerTransport();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}; shutting down stdio MCP server.`);
    await server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);
  logger.info("Travel & Hotel Intelligence MCP server running on stdio transport.");
}

export interface StartHttpServerOptions {
  fetchImpl?: typeof fetch;
  registerSignalHandlers?: boolean;
}

export interface StartedHttpServer {
  httpServer: HttpServer;
  close: () => Promise<void>;
}

export async function startHttpServer(
  config: AppConfig,
  logger: Logger,
  options: StartHttpServerOptions = {},
): Promise<StartedHttpServer> {
  const { fetchImpl, registerSignalHandlers = false } = options;
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });

  const sharedCache = new TtlCache<unknown>({
    ttlSeconds: config.cacheTtlSeconds,
    maxEntries: config.cacheMaxEntries,
  });

  // Validate provider readiness once at startup so warnings are logged immediately.
  const startupProbe = createTravelMcpServer({ config, logger, cache: sharedCache });
  await startupProbe.server.close();

  const sessions = new Map<string, ActiveHttpSession>();

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      status: "ok",
      transport: "streamable-http",
      endpoints: {
        mcp: "/mcp",
        health: "/health",
      },
      enabledProviders: startupProbe.enabledProviders,
      registeredTools: startupProbe.registeredTools,
    });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      name: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "http",
      enabledProviders: startupProbe.enabledProviders,
      registeredTools: startupProbe.registeredTools,
      activeSessions: sessions.size,
      cache: sharedCache.stats(),
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

    try {
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session not found" },
            id: null,
          });
          return;
        }
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: Mcp-Session-Id header is required for non-initialize requests.",
          },
          id: null,
        });
        return;
      }

      const silentLogger: Logger = {
        debug: (m, meta) => logger.debug(m, meta),
        info: () => undefined,
        warn: () => undefined,
        error: (m, meta) => logger.error(m, meta),
      };

      const { server } = createTravelMcpServer({
        config,
        logger: silentLogger,
        cache: sharedCache,
        fetchImpl,
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
          logger.debug("MCP HTTP session initialized", { sessionId: newSessionId });
        },
        onsessionclosed: (closedSessionId) => {
          sessions.delete(closedSessionId);
          logger.debug("MCP HTTP session closed", { sessionId: closedSessionId });
        },
      });

      let sessionClosed = false;
      transport.onclose = () => {
        if (sessionClosed) return;
        sessionClosed = true;
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
        void server.close().catch(() => undefined);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("Error handling POST /mcp request", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const handleSessionMethod = async (req: Request, res: Response): Promise<void> => {
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing Mcp-Session-Id header" },
        id: null,
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) return;
    await session.transport.handleRequest(req, res);
  };

  app.get("/mcp", handleSessionMethod);
  app.delete("/mcp", handleSessionMethod);

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const srv = app.listen(config.port, config.host, () => {
      const address = srv.address();
      const boundPort = typeof address === "object" && address ? address.port : config.port;
      logger.info("Travel & Hotel Intelligence MCP server running on Streamable HTTP", {
        url: `http://${config.host}:${boundPort}/mcp`,
        healthUrl: `http://${config.host}:${boundPort}/health`,
      });
      resolve(srv);
    });
  });

  let closingPromise: Promise<void> | undefined;
  let onSigint: (() => void) | undefined;
  let onSigterm: (() => void) | undefined;

  const closeAll = async (): Promise<void> => {
    if (closingPromise) {
      return closingPromise;
    }

    closingPromise = (async () => {
      if (onSigint) process.off("SIGINT", onSigint);
      if (onSigterm) process.off("SIGTERM", onSigterm);

      for (const [id, session] of sessions.entries()) {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
        sessions.delete(id);
      }

      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err) => {
            if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
              reject(err);
              return;
            }
            resolve();
          });
          httpServer.closeIdleConnections?.();
        });
      }
    })();

    return closingPromise;
  };

  if (registerSignalHandlers) {
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}; closing HTTP MCP server and ${sessions.size} session(s).`);
      await closeAll();
      process.exit(0);
    };

    onSigint = () => void shutdown("SIGINT");
    onSigterm = () => void shutdown("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  }

  return { httpServer, close: closeAll };
}

export async function main(): Promise<void> {
  const baseConfig = loadConfig();
  const overrides = parseCliArgs(process.argv.slice(2));
  const config: AppConfig = {
    ...baseConfig,
    transport: overrides.transport ?? baseConfig.transport,
    host: overrides.host ?? baseConfig.host,
    port: overrides.port ?? baseConfig.port,
  };

  const logger = createLogger(config.logLevel);

  if (config.transport === "http") {
    await startHttpServer(config, logger, { registerSignalHandlers: true });
  } else {
    await startStdioServer(config, logger);
  }
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "Fatal startup error",
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exit(1);
  });
}
