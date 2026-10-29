import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { checkDelayRiskHealth, checkMlHealth, checkWorkloadForecastHealth, getMlMetadata } from './mlService.js';

export type ModelStatus = 'available' | 'coming_soon' | 'unavailable';

const baseModels = [
  {
    id: 'resolution-time',
    displayName: 'Resolution-Time Prediction',
    shortName: 'Resolution time',
    description: 'Estimate elapsed resolution duration from ticket creation-time signals.',
    status: 'unavailable' as ModelStatus,
    inputSchema: 'issue_created, issue_priority, issue_type, issue_proj',
    outputSchema: 'duration in hours, point estimate',
  },
  {
    id: 'operational-risk',
    displayName: 'Operational Risk / Bottleneck Intelligence',
    shortName: 'Risk intelligence',
    description: 'Estimate the probability of a ticket exceeding the model’s 30-day historical delay target using leakage-safe ticket and historical signals.',
    status: 'unavailable' as ModelStatus,
    inputSchema: 'issue_created, issue_priority, issue_type, issue_proj, anonymized intake cohort',
    outputSchema: 'calibrated probability, risk band, high-recall review flag',
  },
  {
    id: 'workload-forecasting',
    displayName: 'Workload / Operations Forecasting',
    shortName: 'Workload forecasting',
    description: 'Refit a tuned XGBoost ensemble on actual daily ticket counts from the workspace or an imported company history.',
    status: 'unavailable' as ModelStatus,
    inputSchema: 'issue_created, issue_type OR date, ticket_count',
    outputSchema: 'daily forecast, planning range, high-load flags',
  },
];

function artifactDir() {
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
  const candidates = [
    path.resolve(process.cwd(), env.mlArtifactDir),
    path.resolve(process.cwd(), 'ml/artifacts/resolution'),
    path.resolve(moduleRoot, 'ml/artifacts/resolution'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function readEvaluation() {
  try {
    const metricsPath = path.join(artifactDir(), 'metrics.json');
    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')) as Record<string, any>;
    return {
      target: metrics.target,
      splits: metrics.splits,
      validation: metrics.validation_model_selection?.best_validation_row,
      finalTest: metrics.final_test,
      testMedianBaseline: metrics.test_median_baseline,
      baselineImprovementHours: metrics.test_baseline_improvement_hours,
    };
  } catch {
    return null;
  }
}

export async function listModels() {
  const [health, riskHealth, forecastHealth] = await Promise.all([checkMlHealth(), checkDelayRiskHealth(), checkWorkloadForecastHealth()]);
  return baseModels.map((model) => model.id === 'resolution-time' ? { ...model, status: health.available ? 'available' : 'unavailable', health: health.data, evaluation: readEvaluation() } : model.id === 'operational-risk' ? { ...model, status: riskHealth.available ? 'available' : 'unavailable', health: riskHealth.data } : model.id === 'workload-forecasting' ? { ...model, status: forecastHealth.available ? 'available' : 'unavailable', health: forecastHealth.data } : model);
}

export async function getModel(modelId: string) {
  const models = await listModels();
  return models.find((model) => model.id === modelId) ?? null;
}

export async function getResolutionMetadata() {
  return getMlMetadata();
}
