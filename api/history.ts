import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readHistoryFile, writeHistorySnapshot, type PersistedHistoryFile } from "./_lib/historyStore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      return res.status(200).json(readHistoryFile());
    }
    if (req.method === "POST") {
      let body: unknown = req.body;
      if (typeof body === "string") {
        body = JSON.parse(body);
      }
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "JSON body required" });
      }
      const saved = writeHistorySnapshot(body as Partial<PersistedHistoryFile>);
      return res.status(200).json(saved);
    }
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ error: "use GET or POST" });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
