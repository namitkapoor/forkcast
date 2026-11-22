import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError } from "./gemini.js";

export interface RouteOptions {
  /** Max serialized request body size in bytes (default: 6MB for multimodal masks/audio). */
  maxBodyBytes?: number;
  /** Max requests per minute per client IP (default: env FORKCAST_RATE_LIMIT_RPM or 60). */
  rateLimitRpm?: number;
}

const DEFAULT_MAX_BODY_BYTES = 6 * 1024 * 1024;
const WINDOW_MS = 60_000;
const ipBuckets = new Map<string, number[]>();

export function resetRateLimiterForTests(): void {
  ipBuckets.clear();
}

function clientIp(req: VercelRequest): string {
  const xff = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : typeof xff === "string" ? xff.split(",")[0] : undefined;
  return raw?.trim() || req.socket?.remoteAddress || "local";
}

function checkRateLimit(ip: string, rpm: number): { allowed: boolean; retryAfterSec: number } {
  if (rpm <= 0) return { allowed: true, retryAfterSec: 0 };
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const prev = ipBuckets.get(ip) ?? [];
  const recent = prev.filter((ts) => ts > cutoff);

  // Periodic cleanup if map grows in long-lived warm containers
  if (ipBuckets.size > 2000) {
    for (const [k, list] of ipBuckets) {
      const kept = list.filter((ts) => ts > cutoff);
      if (kept.length) ipBuckets.set(k, kept);
      else ipBuckets.delete(k);
    }
  }

  if (recent.length >= rpm) {
    const retryAfterSec = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
    ipBuckets.set(ip, recent);
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  ipBuckets.set(ip, recent);
  return { allowed: true, retryAfterSec: 0 };
}

function defaultRpm(): number {
  const envVal = Number(process.env.FORKCAST_RATE_LIMIT_RPM);
  return Number.isFinite(envVal) && envVal >= 0 ? envVal : 60;
}

/**
 * Wrap a JSON POST handler: OPTIONS preflight, method check, payload size limit,
 * sliding-window per-IP rate limit, JSON parsing, request IDs, and structured errors.
 */
export function jsonRoute<T>(fn: (body: T, req: VercelRequest) => Promise<unknown>, opts: RouteOptions = {}) {
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async function handler(req: VercelRequest, res: VercelResponse) {
    const t0 = Date.now();
    const reqId = randomUUID().slice(0, 12);
    res.setHeader("x-request-id", reqId);
    res.setHeader("cache-control", "no-store");

    try {
      if (req.method === "OPTIONS") {
        res.setHeader("allow", "POST, OPTIONS");
        return res.status(204).end();
      }
      if (req.method !== "POST") {
        res.setHeader("allow", "POST, OPTIONS");
        return res.status(405).json({ error: "use POST", requestId: reqId });
      }

      const contentLen = Number(req.headers?.["content-length"] ?? 0);
      if (Number.isFinite(contentLen) && contentLen > maxBodyBytes) {
        throw new HttpError(413, `request body exceeds ${Math.round(maxBodyBytes / 1024)}KB limit`);
      }

      const rpm = opts.rateLimitRpm ?? defaultRpm();
      const rl = checkRateLimit(clientIp(req), rpm);
      if (!rl.allowed) {
        res.setHeader("retry-after", String(rl.retryAfterSec));
        throw new HttpError(429, `rate limit exceeded; retry in ${rl.retryAfterSec}s`);
      }

      let body: unknown = req.body;
      if (typeof body === "string") {
        if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
          throw new HttpError(413, `request body exceeds ${Math.round(maxBodyBytes / 1024)}KB limit`);
        }
        try {
          body = JSON.parse(body);
        } catch {
          throw new HttpError(400, "body is not valid JSON");
        }
      } else if (body && typeof body === "object") {
        const approxLen = JSON.stringify(body).length;
        if (approxLen > maxBodyBytes) {
          throw new HttpError(413, `request body exceeds ${Math.round(maxBodyBytes / 1024)}KB limit`);
        }
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "JSON object body required");
      }

      const out = await fn(body as T, req);
      res.setHeader("x-forkcast-ms", String(Date.now() - t0));
      return res.status(200).json(out);
    } catch (e) {
      const upstreamStatus = (e as { status?: unknown })?.status;
      const status =
        e instanceof HttpError
          ? e.status
          : upstreamStatus === 429
            ? 429
            : 500;
      const rawMessage = e instanceof Error ? e.message : String(e);
      // Never echo environment secrets in error payloads
      const message = rawMessage.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]").slice(0, 500);
      res.setHeader("x-forkcast-ms", String(Date.now() - t0));
      if (status >= 500) {
        console.error(`[api:${reqId}] ${req.url ?? "/api"} ${status} (${Date.now() - t0}ms): ${message}`);
      }
      return res.status(status).json({
        error: message,
        requestId: reqId,
        ...(e instanceof HttpError && e.details ? { details: e.details } : {}),
      });
    }
  };
}
