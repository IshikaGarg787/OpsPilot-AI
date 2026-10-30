import type { RequestHandler } from 'express';
import { env } from '../config/env.js';

let inFlight = 0;

/** Fail fast when this process is saturated instead of letting work queue without a bound. */
export const loadShedder: RequestHandler = (req, res, next) => {
  // Keep platform liveness/readiness probes available even during application saturation.
  if (req.originalUrl.startsWith('/api/v1/health') || req.method === 'OPTIONS') {
    next();
    return;
  }

  if (inFlight >= env.maxInFlightRequests) {
    res.setHeader('Retry-After', '1');
    res.status(503).json({
      success: false,
      message: 'Service is busy. Please retry shortly.',
      code: 'SERVICE_BUSY',
    });
    return;
  }

  inFlight += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight = Math.max(0, inFlight - 1);
  };

  res.once('finish', release);
  res.once('close', release);
  next();
};
