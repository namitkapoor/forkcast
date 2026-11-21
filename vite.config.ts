import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serves /api/<name> in `npm run dev` by loading api/<name>.ts through Vite's SSR loader and
 * calling its default export with Vercel-style (req, res) helpers. Same handler modules as
 * production, so no `vercel dev` needed. Loads .env (all keys, not just VITE_*) into process.env.
 */
function apiRoutes(): Plugin {
  return {
    name: "forkcast-api-routes",
    apply: "serve",
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), "");
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api", async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const name = (req.url ?? "/").split("?")[0].replace(/^\/+|\/+$/g, "");
        const file = path.join(server.config.root, "api", `${name}.ts`);
        if (!name || name.startsWith("_") || name.includes("..") || !existsSync(file)) return next();

        const send = (status: number, body: unknown) => {
          if (res.headersSent) return;
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = undefined;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          const url = new URL(req.url ?? "/", "http://localhost");
          const vreq = Object.assign(req, { body, query: Object.fromEntries(url.searchParams), cookies: {} });
          const vres = Object.assign(res, {
            status(code: number) {
              res.statusCode = code;
              return vres;
            },
            json(obj: unknown) {
              send(res.statusCode || 200, obj);
              return vres;
            },
            send(obj: unknown) {
              if (typeof obj === "object") send(res.statusCode || 200, obj);
              else res.end(String(obj));
              return vres;
            },
          });
          const mod = await server.ssrLoadModule(file);
          await mod.default(vreq, vres);
        } catch (e) {
          server.config.logger.error(`[api/${name}] ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
          send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiRoutes()],
});
