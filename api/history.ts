import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readHistoryFile, writeHistorySnapshot, type PersistedHistoryFile } from "./_lib/historyStore.js";

const MAX_HISTORY_BYTES = 6 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("allow", "GET, POST, OPTIONS");
      return res.status(204).end();
    }
    if (req.method === "GET") {
      return res.status(200).json(readHistoryFile());
    }
    if (req.method === "POST") {
      let body: unknown = req.body;
      if (typeof body === "string") {
        if (Buffer.byteLength(body, "utf8") > MAX_HISTORY_BYTES) {
          return res.status(413).json({ error: "history payload too large" });
        }
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({ error: "body is not valid JSON" });
        }
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "JSON object body required" });
      }
      const saved = writeHistorySnapshot(body as Partial<PersistedHistoryFile>);
      return res.status(200).json(saved);
    }
    res.setHeader("allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "use GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
