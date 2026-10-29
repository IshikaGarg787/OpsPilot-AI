export type ThemePreference = 'light' | 'dark' | 'system';
export type AppRole = 'customer' | 'it_team' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  themePreference: ThemePreference;
}

export type ModelStatus = 'available' | 'coming_soon' | 'unavailable';

export interface ModelInfo {
  id: string;
  displayName: string;
  shortName: string;
  description: string;
  status: ModelStatus;
  inputSchema: string | null;
  outputSchema: string | null;
  health?: { status?: string; service?: string; message?: string };
  evaluation?: Evaluation | null;
}

export interface Evaluation {
  model?: string;
  target?: { definition?: string; unit?: string; prediction_type?: string; included_rows?: number };
  splits?: Array<{ split: string; rows: number; first_created: string; last_created: string }>;
  validation?: { model?: string; validation_mae_hours?: number; validation_rmse_hours?: number; validation_r2?: number };
  finalTest?: { mae_hours?: number; rmse_hours?: number; r2?: number; n_test?: number };
  final_test?: { mae_hours?: number; rmse_hours?: number; r2?: number; n_test?: number };
  testMedianBaseline?: { mae_hours?: number; rmse_hours?: number; r2?: number };
  test_median_baseline?: { mae_hours?: number; rmse_hours?: number; r2?: number };
  baselineImprovementHours?: number;
  test_baseline_improvement_hours?: number;
}

export interface Prediction {
  id: string;
  modelId: string;
  modelVersion?: string;
  predictionType: string;
  input: { issueCreated: string; priority: string; issueType: string; project: string; complaint?: string };
  output?: {
    duration?: number;
    unit?: string;
    delayRisk?: { probability: number; category: 'low' | 'medium' | 'high'; flaggedForReview: boolean; decisionThreshold: number; targetThresholdHours: number; modelVersion?: string };
    workload?: { historyStart: string; historyEnd: string; historyDays: number; horizon: 7 | 14; ticketTotal: number; expectedTickets: number; highLoadDays: number; forecast: Array<{ date: string; forecast: number; planningLow: number; planningHigh: number; highLoad: boolean }> };
  };
  status: 'success' | 'failed';
  errorCode?: string;
  createdAt: string;
}

export interface TriageResult {
  prediction: Prediction;
  risk: { risk_probability: number; risk_category: 'low' | 'medium' | 'high'; flagged_for_review: boolean; decision_threshold: number; target_threshold_hours: number; model_version: string; notes?: string[] };
  resolution: { duration: number; unit: 'hours'; prediction_type: 'point_estimate'; model_version?: string; artifact_generated_at?: string };
  workload: { model_id: string; history_start: string; history_end: string; history_days: number; ticket_total: number; horizon: 7 | 14; forecast: Array<{ date: string; weekday: string; forecast: number; planning_low: number; planning_high: number; high_load_threshold: number; high_load_flag: boolean }> };
}

export type TicketStatus = 'open' | 'triaged' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export interface Ticket {
  id: string; ticketNumber: string; ownerRole: 'customer' | 'it_team'; owner: string;
  subject: string; description: string; category: string; priority: string; project: string;
  status: TicketStatus; assignedTo?: { id: string; name: string; email: string } | null;
  workloadOutlook?: { historyStart?: string; historyEnd?: string; historyDays?: number; horizon?: 7 | 14; expectedTickets?: number; highLoadDays?: number; modelVersion?: string; generatedAt?: string; forecast?: Array<{ date: string; forecast: number; planningLow?: number; planningHigh?: number; highLoad?: boolean }> };
  aiSignals?: { delayRiskProbability?: number; delayRiskCategory?: 'low' | 'medium' | 'high'; flaggedForReview?: boolean; reviewThreshold?: number; targetThresholdHours?: number; resolutionHours?: number; riskModelVersion?: string; resolutionModelVersion?: string; unavailableReason?: string };
  recommendation?: { action?: 'priority_review' | 'standard_queue'; state?: 'pending' | 'approved' | 'rejected' | 'modified'; rationale?: string; decisionNote?: string };
  responses: Array<{ _id: string; authorName: string; authorRole: AppRole; visibility: 'public' | 'internal'; message: string; resolutionNote?: string; createdAt: string }>;
  audit?: Array<{ _id: string; actorName: string; actorRole: AppRole; action: string; details?: string; createdAt: string }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number; createdAt: string }>;
  createdAt: string; updatedAt: string;
}

export interface DashboardSummary {
  totalPredictions: number;
  resolutionPredictions: number;
  averageResolutionHours: number | null;
  availableModels: number;
  models: ModelInfo[];
}

export interface DashboardActivity {
  recent: Prediction[];
  daily: Array<{ _id: string; count: number; averageHours: number }>;
  byPriority: Array<{ _id: string; count: number }>;
}

export interface ModelMetadata {
  status: string;
  model_id: string;
  display_name: string;
  model_name?: string;
  artifact_generated_at?: string;
  raw_input_columns: string[];
  engineered_features: string[];
  prediction_type: string;
  target_unit: string;
  fields: Record<string, { label: string; required: boolean; options: string[] }>;
  evaluation?: Evaluation;
}

export interface PaginatedPredictions {
  items: Prediction[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}
