import 'dotenv/config';

const asBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
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
  sessionSecret: process.env.SESSION_SECRET ?? '',
  cookieSecure: asBoolean(process.env.COOKIE_SECURE, false),
  mlArtifactDir: process.env.ML_ARTIFACT_DIR ?? '../ml/artifacts/resolution',
};

if (!env.sessionSecret) {
  if (env.nodeEnv === 'production') throw new Error('SESSION_SECRET must be configured in production.');
  console.warn('SESSION_SECRET is not configured; development sessions will reset on restart.');
}
