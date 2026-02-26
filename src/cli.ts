#!/usr/bin/env node
/**
 * Clawd Router CLI
 *
 * Standalone proxy server for OpenRouter routing.
 */

import { startProxy, getProxyPort } from "./proxy.js";
import { VERSION } from "./version.js";

function printHelp(): void {
  const help = `clawd-router v${VERSION}

Usage:
  clawd-router [options]

Options:
  --version, -v       Show version number
  --help, -h          Show this help message
  --port <number>     Port to listen on (default: 8403)

Environment:
  OPENROUTER_API_KEY  Required - OpenRouter API key
  CLAWD_ROUTER_PORT   Default proxy port (default: 8403)

Example:
  clawd-router --port 8403
`;
  process.stdout.write(help);
}

function parseArgs(args: string[]): { version: boolean; help: boolean; port?: number } {
  const result: { version: boolean; help: boolean; port?: number } = {
    version: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--port" && i + 1 < args.length) {
      result.port = parseInt(args[i + 1]!, 10);
      i++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("[clawd-router] Warning: OPENROUTER_API_KEY is not set");
  }

  const resolvedPort =
    args.port ?? parseInt(process.env.CLAWD_ROUTER_PORT ?? "8403", 10);

  const proxy = await startProxy({ port: resolvedPort });

  console.log(`[clawd-router] Proxy listening on http://127.0.0.1:${getProxyPort()}`);
  console.log("[clawd-router] Ready - Ctrl+C to stop");

  const shutdown = async (signal: string) => {
    console.log(`\n[clawd-router] Received ${signal}, shutting down...`);
    await proxy.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => process.exit(1));
  });

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(`[clawd-router] Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
