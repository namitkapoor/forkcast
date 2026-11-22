import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadDotEnv } from "./_lib/env.js";
import { modelSnapshot } from "./_lib/models.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("allow", "GET, HEAD, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD, OPTIONS");
    return res.status(405).json({ error: "use GET" });
  }
  if (!process.env.GEMINI_API_KEY?.trim()) loadDotEnv();
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  if (req.method === "HEAD") {
    return res.status(hasApiKey ? 200 : 503).end();
  }
  return res.status(200).json({
    ok: true,
    hasApiKey,
    models: modelSnapshot(),
    timestamp: new Date().toISOString(),
  });
}
