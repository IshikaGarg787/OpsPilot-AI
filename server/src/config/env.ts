import 'dotenv/config';

const asBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
};

const positiveInteger = (value: string | undefined, fallback: number, maximum: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5000),
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  mongodbUri: process.env.MONGODB_URI?.trim() || 'mongodb://127.0.0.1:27017/opspilot_ai',
  mlServiceUrl: (process.env.ML_SERVICE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, ''),
  delayRiskServiceUrl: (process.env.DELAY_RISK_SERVICE_URL ?? 'http://127.0.0.1:8001').replace(/\/$/, ''),
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL?.trim() || 'llama3.2:3b',
  modelApiToken: process.env.MODEL_API_TOKEN?.trim() ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  cookieSecure: asBoolean(process.env.COOKIE_SECURE, false),
  mlArtifactDir: process.env.ML_ARTIFACT_DIR ?? '../ml/artifacts/resolution',
  mongodbMaxPoolSize: positiveInteger(process.env.MONGODB_MAX_POOL_SIZE, 100, 1000),
  mongodbWaitQueueTimeoutMs: positiveInteger(process.env.MONGODB_WAIT_QUEUE_TIMEOUT_MS, 5000, 120_000),
  maxInFlightRequests: positiveInteger(process.env.MAX_IN_FLIGHT_REQUESTS, 250, 10_000),
  apiRateLimitWindowMs: positiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 24 * 60 * 60 * 1000),
  apiRateLimitMax: positiveInteger(process.env.API_RATE_LIMIT_MAX, 300, 1_000_000),
  runSlaScheduler: asBoolean(process.env.RUN_SLA_SCHEDULER, true),
};

if (!env.sessionSecret) {
  if (env.nodeEnv === 'production') throw new Error('SESSION_SECRET must be configured in production.');
  console.warn('SESSION_SECRET is not configured; development sessions will reset on restart.');
}
