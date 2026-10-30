export type ThemePreference = 'light' | 'dark' | 'system' | 'cyber' | 'aurora';
export type AppRole = 'customer' | 'it_team' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  themePreference: ThemePreference;
  skills?: string[];
  availability?: 'available' | 'unavailable';
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
  input: { issueCreated: string; priority: string; issueType: string; project: string; complaint?: string; ticketId?: string };
  output?: {
    duration?: number;
    unit?: string;
    delayRisk?: { probability: number; category: 'low' | 'medium' | 'high'; flaggedForReview: boolean; decisionThreshold: number; targetThresholdHours: number; modelVersion?: string; explanation?: { summary?: string; historicalEvidence?: Array<{ factor: string; value: string; historicalTickets: number; historicalDelayRate: number }>; evidenceCutoff?: string; interpretation?: string } };
    workload?: { historyStart: string; historyEnd: string; historyDays: number; horizon: 7 | 14; ticketTotal: number; expectedTickets: number; highLoadDays: number; source?: 'workspace_ticket_history' | 'uploaded_csv' | 'queue_history' | 'triage'; forecast: Array<{ date: string; forecast: number; planningLow: number; planningHigh: number; highLoad: boolean }> };
  };
  status: 'success' | 'failed';
  errorCode?: string;
  linkedTicket?: { id: string; ticketNumber?: string } | null;
  createdAt: string;
}

export interface WorkloadForecastRow {
  date: string;
  weekday: string;
  forecast: number;
  planning_low: number;
  planning_high: number;
  high_load_threshold: number;
  high_load_flag: boolean;
}

export interface WorkloadForecastResult {
  model_id: string;
  model_name: string;
  mode: string;
  generated_at: string;
  history_start: string;
  history_end: string;
  history_days: number;
  ticket_total: number;
  horizon: 7 | 14;
  forecast: WorkloadForecastRow[];
  recent_history: Array<{ date: string; ticket_count: number }>;
  notes: string[];
  prediction_id?: string;
  source?: 'workspace_ticket_history' | 'uploaded_csv' | 'queue_history';
}

export interface WorkloadForecastHealth {
  available: boolean;
  status?: string;
  service?: string;
  message?: string;
  configurations_available?: number;
  reason?: string;
}

export interface TriageResult {
  prediction: Prediction;
  risk: { risk_probability: number; risk_category: 'low' | 'medium' | 'high'; flagged_for_review: boolean; decision_threshold: number; target_threshold_hours: number; model_version: string; notes?: string[]; explanation?: { summary: string; historical_evidence: Array<{ factor: string; value: string; historical_tickets: number; historical_delay_rate: number }>; evidence_cutoff: string; interpretation: string } };
  resolution: { duration: number; unit: 'hours'; prediction_type: 'point_estimate'; model_version?: string; artifact_generated_at?: string };
  workload: { model_id: string; history_start: string; history_end: string; history_days: number; ticket_total: number; horizon: 7 | 14; source?: 'workspace_ticket_history' | 'uploaded_csv' | 'queue_history' | 'triage'; forecast: Array<{ date: string; weekday: string; forecast: number; planning_low: number; planning_high: number; high_load_threshold: number; high_load_flag: boolean }> };
  recommendation: { action: 'priority_review' | 'standard_queue'; rationale: string; recommendedPriority: string; assignee: { id: string; name: string; activeTickets: number; matchingSkills: string[] } | null };
  sla: TicketSla | null;
}

export interface TicketSlaCalculation { status: 'not_applicable' | 'on_track' | 'at_risk' | 'breached' | 'met'; deadlineAt: string | null; remainingHours: number | null; elapsedHours: number | null; clockPaused: boolean; timeBasis: 'calendar_hours' | 'business_hours' }
export interface TicketSla { policy: { policyId: string; version: string }; response: TicketSlaCalculation; resolution: TicketSlaCalculation }
export interface CapacityPlan { _id: string; horizon: 7 | 14; expectedDemand: number; baselineCapacityPerDay: number; proposedCapacityPerDay: number; baselineUncovered: number; proposedUncovered: number; coverageImprovement: number; baselinePeakBacklog: number; proposedPeakBacklog: number; baselineBacklogAtHorizon: number; proposedBacklogAtHorizon: number; baselineClearanceDays: number | null; proposedClearanceDays: number | null; baselineOverloadedDays: number; proposedOverloadedDays: number; note: string; createdAt: string }
export interface SlaPolicy { _id: string; name: string; priority: string; firstResponseMinutes: number; resolutionMinutes: number; enabled: boolean; createdAt: string; updatedAt: string }
export interface SlaEvent { _id: string; kind: string; ticketId?: string | null; ticketNumber?: string | null; slaType?: string | null; threshold?: number | null; message: string; createdAt: string }
export interface SlaOverview { metrics: { compliancePercent: number | null; approaching: number; breached: number; met: number; averageFirstResponseHours: number | null; averageResolutionHours: number | null }; tickets: Array<{ _id: string; ticketNumber: string; subject: string; priority: string; status: TicketStatus; assignedTo?: { name: string } | null; aiSignals?: { delayRiskCategory?: 'low' | 'medium' | 'high'; delayRiskProbability?: number }; slaSnapshot?: { policyName?: string; firstResponseDeadlineAt?: string; resolutionDeadlineAt?: string; firstResponseStatus?: string; resolutionStatus?: string } }>; events: SlaEvent[] }
export interface OperationsDashboardData {
  summary: { open: number; compliancePercent: number | null; activeBreaches: number; atRisk: number; highRisk: number; averageResolutionHours: number | null };
  priorityStatus: Array<{ _id: { priority: string; status: string }; count: number }>;
  riskDistribution: Array<{ _id: 'low' | 'medium' | 'high'; count: number }>;
  workload: Array<{ assigneeId: string | null; name: string; count: number; overdue: number }>;
  attention: Array<{ _id: string; ticketNumber: string; subject: string; priority: string; category: string; status: TicketStatus; assignee: string | null; firstResponseDeadlineAt?: string; resolutionDeadlineAt?: string; firstResponseStatus?: string; resolutionStatus?: string; delayRiskCategory?: 'low' | 'medium' | 'high'; delayRiskProbability?: number; updatedAt: string }>;
  events: SlaEvent[];
  trend: Array<{ date: string; responseEligible: number; responseMet: number; resolutionEligible: number; resolutionMet: number; eligible: number; met: number; compliancePercent: number }>;
  filterOptions: { priorities: string[]; categories: string[] };
}

export type TicketStatus = 'open' | 'triaged' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type TicketInputLanguage = 'auto' | 'hindi' | 'english' | 'hinglish';
export interface Ticket {
  id: string; ticketNumber: string; ownerRole: 'customer' | 'it_team'; owner?: string;
  subject: string; description: string; inputLanguage?: TicketInputLanguage; category: string; priority: string; prioritySource?: 'auto' | 'admin_override' | 'legacy'; project: string;
  status: TicketStatus; assignedTo?: { id: string; name: string; email?: string } | null;
  estimatedResolutionAt?: string | null; delayExplanation?: string;
  sla?: TicketSla | null;
  workloadOutlook?: { historyStart?: string; historyEnd?: string; historyDays?: number; actualHistoryDays?: number; horizon?: 7 | 14; expectedTickets?: number; highLoadDays?: number; modelVersion?: string; generatedAt?: string; forecast?: Array<{ date: string; forecast: number; planningLow?: number; planningHigh?: number; highLoad?: boolean }> };
  aiSignals?: { delayRiskProbability?: number; delayRiskCategory?: 'low' | 'medium' | 'high'; flaggedForReview?: boolean; reviewThreshold?: number; targetThresholdHours?: number; resolutionHours?: number; riskModelVersion?: string; resolutionModelVersion?: string; workloadModelVersion?: string; workloadHighLoadDays?: number; workloadHorizon?: number; workloadActualHistoryDays?: number; autoPriorityScore?: number; autoPriorityRationale?: string; unavailableReason?: string; riskExplanation?: { summary?: string; historicalEvidence?: Array<{ factor: string; value: string; historicalTickets?: number; historical_tickets?: number; historicalDelayRate?: number; historical_delay_rate?: number }>; interpretation?: string }; recommendedAssignee?: { id: string; name: string; activeTickets: number; matchingSkills?: string[] }; recommendedPriority?: string };
  recommendation?: { action?: 'priority_review' | 'standard_queue'; state?: 'pending' | 'approved' | 'rejected' | 'modified'; rationale?: string; decisionNote?: string };
  responses: Array<{ _id: string; authorName: string; authorRole: AppRole; visibility: 'public' | 'internal'; message: string; resolutionNote?: string; createdAt: string }>;
  audit?: Array<{ _id: string; actorName: string; actorRole: AppRole; action: string; details?: string; createdAt: string }>;
  customerTimeline?: CustomerTicketEvent[];
  resolutionSummary?: string | null;
  attachments: Array<{ id: string; fileName: string; mimeType: string; size: number; createdAt: string }>;
  createdAt: string; updatedAt: string;
}

export interface CustomerTicketEvent {
  id: string;
  kind: 'created' | 'assigned' | 'status' | 'resolved' | 'closed' | 'reply';
  label: string;
  status?: TicketStatus;
  createdAt: string;
}

export interface CustomerTicketActivity extends CustomerTicketEvent {
  ticketId: string;
  ticketNumber: string;
  subject: string;
}

export interface CustomerDashboardData {
  counts: { total: number; open: number; inProgress: number; resolved: number };
  activity: CustomerTicketActivity[];
}

export interface CustomerTicketPage {
  tickets: Ticket[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface DashboardSummary {
  totalPredictions: number;
  resolutionPredictions: number;
  delayRiskPredictions: number;
  workloadForecasts: number;
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
  model_version?: string;
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
