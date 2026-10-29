import { ArrowRight, CheckCircle2, Clock3, ExternalLink, Gauge, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorState, LoadingState, Notice, PageIntro, StatusPill } from '../components/ui';
import { api } from '../services/api';
import type { ModelInfo } from '../types';

function Metric({ label, value, unit = '' }: { label: string; value?: number; unit?: string }) {
  return (
    <div className="evaluation-metric">
      <span>{label}</span>
      <strong>{value == null ? '—' : `${value.toFixed(1)}${unit}`}</strong>
    </div>
  );
}

export function ModelCenterPage() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.models.list()
      .then(({ models: next }) => setModels(next))
      .catch((err) => setError(err instanceof Error ? err.message : 'Model registry is unavailable.'));
  }, []);

  if (error) return <><PageIntro eyebrow="Intelligence registry" title="Model center" description="See which intelligence modules are connected to this workspace." /><ErrorState message={error} /></>;
  if (!models) return <><PageIntro eyebrow="Intelligence registry" title="Model center" description="See which intelligence modules are connected to this workspace." /><LoadingState label="Checking model services" /></>;

  const resolution = models.find((model) => model.id === 'resolution-time');
  const evaluation = resolution?.evaluation;
  const test = evaluation?.finalTest ?? evaluation?.final_test;
  const baseline = evaluation?.testMedianBaseline ?? evaluation?.test_median_baseline;
  const risk = models.find((model) => model.id === 'operational-risk');

  return (
    <div className="page-stack">
      <PageIntro eyebrow="Intelligence registry" title="Model center" description="One shared registry for the services powering the operational decision workflow." />
      <Notice variant={resolution?.status === 'available' && risk?.status === 'available' ? 'success' : 'warning'}>
        {resolution?.status === 'available' && risk?.status === 'available' ? (
          <><strong>Ticket decision services are available.</strong> Run the connected workflow with refreshed ticket history.</>
        ) : (
          <><strong>One or more services are unavailable.</strong> Start the required model processes and refresh this page; unavailable services do not produce placeholder scores.</>
        )}
      </Notice>

      <div className="model-center-grid">
        {models.map((model) => (
          <Card className={`registry-card ${model.status === 'available' ? 'registry-active' : ''}`} key={model.id}>
            <div className="registry-top">
              <span className="registry-icon">
                {model.id === 'resolution-time' ? <Clock3 size={21} /> : model.id === 'operational-risk' ? <Sparkles size={21} /> : <Gauge size={21} />}
              </span>
              <StatusPill status={model.status} />
            </div>
            <h2>{model.displayName}</h2>
            <p>{model.description.replace(/model\?Ts/g, "model's")}</p>
            {model.id === 'workload-forecasting' ? (
              <Link className="card-link registry-action" to="/app/workload-forecasting">
                Open forecaster <ArrowRight size={15} />
              </Link>
            ) : model.status === 'available' ? (
              <Link className="card-link registry-action" to={model.id === 'operational-risk' ? '/app/triage' : '/app/resolution-time'}>
                {model.id === 'operational-risk' ? 'Open ticket triage' : 'Open predictor'} <ArrowRight size={15} />
              </Link>
            ) : (
              <span className="registry-placeholder">
                <Clock3 size={14} /> {model.status === 'coming_soon' ? 'Not integrated' : 'Service unavailable'}
              </span>
            )}
          </Card>
        ))}
      </div>

      {resolution && (
        <div className="evaluation-layout">
          <Card title="Resolution model evaluation" action={<span className="historical-label"><CheckCircle2 size={14} /> Historical artifact metrics</span>}>
            <p className="card-subtitle">Reported on an untouched chronological test split. These are historical evaluation results, not a guarantee of live accuracy.</p>
            {test ? (
              <div className="evaluation-grid">
                <Metric label="MAE" value={test.mae_hours} unit=" h" />
                <Metric label="RMSE" value={test.rmse_hours} unit=" h" />
                <Metric label="R²" value={test.r2} />
                <Metric label="Test rows" value={test.n_test} />
              </div>
            ) : (
              <div className="state-block"><span>Evaluation artifact not available.</span></div>
            )}
            <div className="evaluation-details">
              <span>Model: <strong>{resolution.health?.status === 'available' ? 'Tuned HistGradientBoostingRegressor' : 'Artifact metadata'}</strong></span>
              <span>Target: <strong>Elapsed resolution time in hours</strong></span>
              {baseline?.mae_hours != null && <span>Test median baseline MAE: <strong>{baseline.mae_hours.toFixed(1)} h</strong></span>}
              {baseline?.mae_hours != null && test?.mae_hours != null && (
                <span>MAE vs. median baseline: <strong>{Math.abs(baseline.mae_hours - test.mae_hours).toFixed(1)} h {test.mae_hours <= baseline.mae_hours ? 'lower' : 'higher'}</strong></span>
              )}
            </div>
          </Card>
          <Card title="Known limitations">
            <ul className="limitations-list">
              <li>Negative R² means squared error is worse than a mean predictor on this test split, even though MAE beats the included median baseline.</li>
              <li>Predictions are point estimates; no calibrated uncertainty interval is available.</li>
              <li>Historical results do not establish future accuracy or a service-level guarantee.</li>
            </ul>
            <a className="card-link" href="https://data.mendeley.com/datasets/btm76zndnt/3" target="_blank" rel="noreferrer">
              Dataset context <ExternalLink size={14} />
            </a>
          </Card>
        </div>
      )}
    </div>
  );
}
