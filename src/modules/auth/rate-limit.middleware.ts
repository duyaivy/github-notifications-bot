import type { RequestHandler } from "express";

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function createRateLimitMiddleware({ maxRequests, windowMs }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();

  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 1000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) {
          buckets.delete(key);
        }
      }
    }

    const tokenId = req.auth?.extra?.tokenId;
    const key = typeof tokenId === "string" ? `tok:${tokenId}` : `ip:${req.ip || "unknown"}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: {
          message: "Rate limit exceeded"
        }
      });
      return;
    }

    next();
  };
}
