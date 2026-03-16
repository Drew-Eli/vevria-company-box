/**
 * Local proxy between Claude Code and OpenRouter.
 *
 * Claude Code only knows Anthropic models. This proxy:
 * 1. Fakes /v1/models so Claude Code thinks claude-sonnet-4-6 is available
 * 2. Intercepts POST /v1/messages and swaps the model to whatever the user selected
 * 3. Forwards to OpenRouter which routes to the actual model
 *
 * This means ANY model on OpenRouter works — Claude, GPT-4o, Gemini, Llama, etc.
 * Claude Code is none the wiser.
 */
import http from "http";
import https from "https";

let targetModel = "anthropic/claude-sonnet-4-6";
let apiKey = "";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3100");

export function setTargetModel(model: string) {
  targetModel = model;
  console.log(`[proxy] Target model: ${targetModel}`);
}

export function setApiKey(key: string) {
  apiKey = key;
}

export function startProxy(): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);

        // Fake /v1/models — tell Claude Code its model exists
        if (req.url?.includes("/models")) {
          const fake = JSON.stringify({
            data: [
              { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", type: "model" },
              { id: "claude-opus-4-6", display_name: "Claude Opus 4.6", type: "model" },
              { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", type: "model" },
            ],
          });
          res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(fake) });
          res.end(fake);
          return;
        }

        // For message requests, swap the model
        let newBody = body;
        if (req.method === "POST" && body.length > 0) {
          try {
            const json = JSON.parse(body.toString());
            if (json.model) {
              json.model = targetModel;
              newBody = Buffer.from(JSON.stringify(json));
            }
          } catch { /* pass through */ }
        }

        // Forward to OpenRouter
        const opts: https.RequestOptions = {
          hostname: "openrouter.ai",
          port: 443,
          path: `/api${req.url}`,
          method: req.method,
          headers: {
            "content-type": "application/json",
            "content-length": newBody.length,
            "authorization": `Bearer ${apiKey}`,
            "anthropic-version": (req.headers["anthropic-version"] as string) || "2023-06-01",
            "host": "openrouter.ai",
          },
        };

        const proxyReq = https.request(opts, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
          console.error("[proxy] Error:", err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: err.message }));
        });

        proxyReq.end(newBody);
      });
    });

    server.listen(PROXY_PORT, "127.0.0.1", () => {
      console.log(`[proxy] Listening on 127.0.0.1:${PROXY_PORT} → ${targetModel}`);
      resolve(PROXY_PORT);
    });
  });
}
