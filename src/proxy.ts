/**
 * Local proxy that sits between Claude Code and OpenRouter.
 * Rewrites model names: "claude-sonnet-4-6" → "anthropic/claude-sonnet-4-6"
 * Also handles the /v1/models endpoint to return Anthropic-compatible format.
 */
import http from "http";
import https from "https";

const UPSTREAM = process.env.OPENROUTER_URL || "https://openrouter.ai";
const API_KEY = process.env.OPENROUTER_API_KEY || "";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3100");

// Model name mapping: Claude Code sends bare names, OpenRouter needs anthropic/ prefix
function rewriteModel(model: string): string {
  if (model.includes("/")) return model; // already has provider prefix
  // Map Claude Code's model names to OpenRouter IDs
  if (model.startsWith("claude-")) return `anthropic/${model}`;
  return model;
}

export function startProxy(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let body = Buffer.concat(chunks);

        // Rewrite model name in request body
        if (req.method === "POST" && body.length > 0) {
          try {
            const json = JSON.parse(body.toString());
            if (json.model) {
              json.model = rewriteModel(json.model);
              body = Buffer.from(JSON.stringify(json));
            }
          } catch { /* not JSON, pass through */ }
        }

        const upstreamUrl = new URL(UPSTREAM);
        const options: https.RequestOptions = {
          hostname: upstreamUrl.hostname,
          port: upstreamUrl.port || 443,
          path: `/api${req.url}`, // OpenRouter expects /api/v1/messages, Claude sends /v1/messages
          method: req.method,
          headers: {
            ...req.headers,
            host: upstreamUrl.hostname,
            "content-length": body.length,
            "x-api-key": API_KEY,
            "authorization": `Bearer ${API_KEY}`,
          },
        };

        // Remove hop-by-hop headers
        const h = options.headers as Record<string, unknown>;
        delete h["connection"];
        delete h["transfer-encoding"];

        const proxyReq = https.request(options, (proxyRes) => {
          // For /v1/models endpoint, rewrite response to Anthropic format
          if (req.url?.includes("/models")) {
            const responseChunks: Buffer[] = [];
            proxyRes.on("data", (c) => responseChunks.push(c));
            proxyRes.on("end", () => {
              try {
                const data = JSON.parse(Buffer.concat(responseChunks).toString());
                // Build Anthropic-compatible models response
                // Claude Code just needs to find its model in the list
                const models = (data.data || [])
                  .filter((m: { id: string }) => m.id.startsWith("anthropic/"))
                  .map((m: { id: string; name?: string }) => ({
                    id: m.id.replace("anthropic/", ""),
                    display_name: m.name || m.id,
                    type: "model",
                  }));
                const response = JSON.stringify({ data: models });
                res.writeHead(200, {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(response),
                });
                res.end(response);
              } catch {
                res.writeHead(proxyRes.statusCode || 500);
                res.end(Buffer.concat(responseChunks));
              }
            });
          } else {
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            proxyRes.pipe(res);
          }
        });

        proxyReq.on("error", (err) => {
          console.error("[proxy] Upstream error:", err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: err.message }));
        });

        proxyReq.end(body);
      });
    });

    server.listen(PROXY_PORT, "127.0.0.1", () => {
      console.log(`[proxy] OpenRouter proxy listening on 127.0.0.1:${PROXY_PORT}`);
      resolve(PROXY_PORT);
    });
  });
}
