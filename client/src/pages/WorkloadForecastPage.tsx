import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CalendarClock, FileUp, RefreshCw, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../services/api';
import type { WorkloadForecastResult } from '../types';
import { aggregateWorkloadHistory, parseCsv } from '../utils/workloadHistory';

export function WorkloadForecastPage() {
  const [file, setFile] = useState<File | null>(null);
  const [horizon, setHorizon] = useState<7 | 14>(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WorkloadForecastResult | null>(null);
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [serviceError, setServiceError] = useState('');
  const chartData = useMemo(() => result?.forecast.map(r => ({ ...r, day: new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })) ?? [], [result]);

  const checkService = useCallback(async () => {
    setServiceStatus('checking'); setServiceError('');
    try {
      const health = await api.predictions.workloadHealth();
      if (!health.available || health.status !== 'available') throw new Error('Forecast service is not ready.');
      setServiceStatus('available');
    } catch {
      setServiceStatus('unavailable');
      setServiceError('Forecast service is unavailable. Start the ML service, then check again.');
    }
  }, []);

  useEffect(() => { void checkService(); }, [checkService]);

  async function runForecast() {
    if (!file) { setError('Choose a CSV containing ticket history first.'); return; }
    if (serviceStatus !== 'available') { setError(serviceError || 'Forecast service is not ready yet.'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const records = aggregateWorkloadHistory(parseCsv(await file.text()));
      const response = await api.predictions.forecastWorkload({ records, horizon });
      setResult(response);
    } catch (e) { setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not run the forecast.'); }
    finally { setLoading(false); }
  }

  return <div className="page-stack workload-page">
    <div className="page-intro"><div><span className="eyebrow">LIVE DATA · MODEL 03</span><h1>Workload forecasting</h1><p>Upload refreshed ticket records to refit the forecasting ensemble and estimate the next 7 or 14 days.</p></div><span className="status-pill" role="status" aria-live="polite"><span className="pulse-dot"/>{serviceStatus === 'checking' ? ' Checking service' : serviceStatus === 'available' ? ' Ready to forecast' : ' Service unavailable'}</span></div>
    <div className="forecast-upload-card">
      <div className="forecast-upload-icon"><FileUp size={23}/></div><div className="forecast-upload-copy"><h2>Use your latest ticket data</h2><p>Ticket-level CSV: <code>issue_created</code> (optionally <code>issue_type</code>). Or daily aggregate CSV: <code>date,ticket_count</code>. Only Ticket, Service, and HD Service issue types are counted. At least 120 days of history required.</p>
        <label className="file-picker"> <FileUp size={16}/><span>{file ? file.name : 'Choose CSV file'}</span><input type="file" accept=".csv,text/csv" onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); setResult(null); }}/></label>
      </div><div className="forecast-controls"><label>Horizon<select value={horizon} onChange={e => setHorizon(Number(e.target.value) as 7 | 14)}><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option></select></label><button className="primary-button" onClick={runForecast} disabled={loading || !file || serviceStatus !== 'available'}>{loading ? <><RefreshCw className="spin" size={16}/> Forecasting…</> : <><TrendingUp size={16}/> Generate forecast</>}</button></div>
    </div>
    {serviceStatus === 'unavailable' && <div className="inline-error" role="alert"><AlertTriangle size={17}/><span>{serviceError}</span><button type="button" className="button button-secondary" onClick={() => void checkService()}>Retry connection</button></div>}
    {error && <div className="inline-error"><AlertTriangle size={17}/>{error}</div>}
    {result && <>
      <div className="forecast-meta"><span><Activity size={15}/> {result.model_name}</span><span>History: {result.history_start} — {result.history_end}</span><span>Generated {new Date(result.generated_at).toLocaleString()}</span></div>
      <div className="metric-grid forecast-metrics"><div className="metric-card"><span>History coverage</span><strong>{result.history_days.toLocaleString()} days</strong><small>Daily series after cleaning</small></div><div className="metric-card"><span>Tickets in uploaded data</span><strong>{result.ticket_total.toLocaleString()}</strong><small>From this upload only</small></div><div className="metric-card"><span>Expected workload</span><strong>{Math.round(result.forecast.reduce((s,r)=>s+r.forecast,0)).toLocaleString()}</strong><small>Estimated tickets over {result.horizon} days</small></div><div className="metric-card"><span>High-load days</span><strong>{result.forecast.filter(r=>r.high_load_flag).length}</strong><small>Forecast at or above recent threshold</small></div></div>
      <section className="panel forecast-chart-panel"><div className="panel-heading"><div><h2>Forward workload outlook</h2><p>Forecast is recalculated from the CSV you submitted.</p></div><span className="chart-legend"><i/> Forecast volume</span></div><div className="forecast-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{top:10,right:10,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day" tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false} width={42}/><Tooltip formatter={(v) => [`${Number(v).toFixed(1)} tickets`, 'Forecast']}/><Bar dataKey="forecast" radius={[6,6,0,0]} fill="#6478e8"/></BarChart></ResponsiveContainer></div></section>
      <section className="panel"><div className="panel-heading"><div><h2>Daily forecast</h2><p>Planning range is a variability estimate, not a calibrated confidence interval. High-load days use the recent weekday 75th percentile.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Day</th><th>Forecast</th><th>Planning range</th><th>Load signal</th></tr></thead><tbody>{result.forecast.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.weekday}</td><td><strong>{r.forecast.toFixed(1)}</strong></td><td>{r.planning_low.toFixed(1)} – {r.planning_high.toFixed(1)}</td><td><span className={r.high_load_flag?'risk-pill':'neutral-pill'}>{r.high_load_flag?'High load':'Normal'}</span></td></tr>)}</tbody></table></div></section>
      <div className="forecast-disclaimer"><AlertTriangle size={17}/><div><strong>Interpretation and limitations</strong><ul>{result.notes.map(n=><li key={n}>{n}</li>)}</ul></div></div>
    </>}
    {!result && !error && <div className="forecast-empty"><CalendarClock size={26}/><h2>Ready for your latest workload data</h2><p>This page does not display the old saved forecast as if it were live. Upload a fresh CSV to generate a new forecast.</p></div>}
  </div>;
}
