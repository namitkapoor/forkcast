import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError } from "./gemini.js";

/** Wrap a JSON POST handler: method check, body parsing, JSON errors with status codes. */
export function jsonRoute<T>(fn: (body: T) => Promise<unknown>) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    const t0 = Date.now();
    try {
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return res.status(405).json({ error: "use POST" });
      }
      let body: unknown = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          throw new HttpError(400, "body is not valid JSON");
        }
      }
      if (!body || typeof body !== "object") throw new HttpError(400, "JSON body required");
      const out = await fn(body as T);
      res.setHeader("x-forkcast-ms", String(Date.now() - t0));
      return res.status(200).json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status >= 500) console.error(`[api] ${req.url} ${status}: ${message}`);
      return res.status(status).json({ error: message, ...(e instanceof HttpError && e.details ? { details: e.details } : {}) });
    }
  };
}
