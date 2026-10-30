import { env } from '../config/env.js';

export class MlServiceError extends Error {
  constructor(message: string, public code = 'ML_SERVICE_UNAVAILABLE', public status = 503) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}, timeoutMs = 6000, baseUrl = env.mlServiceUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(env.modelApiToken ? { 'x-model-token': env.modelApiToken } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof body?.detail === 'string' ? body.detail : 'The model service rejected the request.';
      throw new MlServiceError(message, response.status === 422 ? 'ML_VALIDATION_ERROR' : 'ML_SERVICE_ERROR', response.status === 422 ? 400 : 503);
    }
    return body;
  } catch (error) {
    if (error instanceof MlServiceError) throw error;
    const message = error instanceof Error && error.name === 'AbortError' ? 'The model service timed out.' : 'The model service is unavailable.';
    throw new MlServiceError(message, error instanceof Error && error.name === 'AbortError' ? 'ML_TIMEOUT' : 'ML_SERVICE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

export async function checkMlHealth() {
  try {
    const result = await request('/health', {}, 2500);
    return { available: result?.status === 'available', data: result };
  } catch (error) {
    return { available: false, data: { status: 'unavailable', message: error instanceof Error ? error.message : 'Unavailable' } };
  }
}

export function getMlMetadata() {
  return request('/metadata');
}

export function predictResolution(payload: Record<string, string>) {
  return request('/predict/resolution-time', { method: 'POST', body: JSON.stringify(payload) }, 120000);
}

export async function checkWorkloadForecastHealth() {
  try {
    const result = await request('/forecast/health', {}, 2500);
    return { available: result?.status === 'available', data: result };
  } catch (error) {
    return { available: false, data: { status: 'unavailable', message: error instanceof Error ? error.message : 'Unavailable' } };
  }
}

export async function checkDelayRiskHealth() {
  try {
    const result = await request('/health', {}, 3000, env.delayRiskServiceUrl);
    return { available: result?.status === 'available', data: result };
  } catch (error) {
    return { available: false, data: { status: 'unavailable', message: error instanceof Error ? error.message : 'Unavailable' } };
  }
}

export function predictDelayRisk(payload: Record<string, string>) {
  return request('/predict/delay-risk', { method: 'POST', body: JSON.stringify(payload) }, 120000, env.delayRiskServiceUrl);
}

export function forecastWorkload(records: Record<string, unknown>[], horizon: 7 | 14) {
  return request('/forecast/workload', { method: 'POST', body: JSON.stringify({ records, horizon }) }, 180000);
}
