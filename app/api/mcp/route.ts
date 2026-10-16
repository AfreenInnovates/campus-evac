import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "@/app/mcp/server";

export const runtime = "nodejs";
/** A drill keeps running after its reply, for up to four minutes of simulated time. */
export const maxDuration = 300;

/**
 * The MCP endpoint (Streamable HTTP, protocol 2025-11-25) that Alexa+ and other MCP clients
 * connect to.
 *
 * Stateless: every POST gets a fresh server and transport and a plain JSON reply, so it runs
 * on serverless hosting with no session store. Nothing here streams or calls back, so there
 * is no GET stream to open and no session to DELETE.
 *
 * Browsers are the only clients that send an Origin; one is let in only when it is listed in
 * MCP_ALLOWED_ORIGINS, so a web page cannot drive the server from a visitor's browser.
 */

const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const jsonRpcError = (status: number, message: string, headers?: Record<string, string>) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return jsonRpcError(403, `Origin not allowed: ${origin}`);

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    // a JSON reply is complete once handleRequest returns
    void server.close();
  }
}

const notAllowed = () => jsonRpcError(405, "Method not allowed: this server is stateless, POST only.", { Allow: "POST" });
export const GET = notAllowed;
export const DELETE = notAllowed;
