import type { DashboardActivity, DashboardSummary, ModelInfo, ModelMetadata, PaginatedPredictions, Prediction, ThemePreference, Ticket, TriageResult, User } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new ApiError(body.message ?? 'Request failed.', response.status, body.code, body.details);
  return body.data as T;
}

export const api = {
  auth: {
    me: () => request<{ user: User }>('/auth/me'),
    login: (payload: { email: string; password: string; remember: boolean }) => request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
    signup: (payload: { name: string; email: string; password: string; termsAccepted: boolean }) => request<{ user: User }>('/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
    logout: () => request<null>('/auth/logout', { method: 'POST' }),
  },
  admin: {
    me: () => request<{ admin: { id: string; username: string; role: 'admin' } }>('/admin/me'),
  },
  users: {
    updateProfile: (name: string) => request<{ user: User }>('/users/me', { method: 'PATCH', body: JSON.stringify({ name }) }),
    updatePreferences: (themePreference: ThemePreference) => request<{ user: User }>('/users/me/preferences', { method: 'PATCH', body: JSON.stringify({ themePreference }) }),
  },
  dashboard: {
    summary: () => request<DashboardSummary>('/dashboard/summary'),
    activity: () => request<DashboardActivity>('/dashboard/activity'),
  },
  models: {
    list: () => request<{ models: ModelInfo[] }>('/models'),
    metadata: () => request<ModelMetadata>('/models/resolution-time/metadata'),
  },
  predictions: {
    createResolution: (payload: { issue_created: string; issue_priority: string; issue_type: string; issue_proj: string }) => request<{ prediction: Prediction; duration: number; unit: string; predictionType: string; modelId: string; modelVersion?: string }>('/predictions/resolution-time', { method: 'POST', body: JSON.stringify(payload) }),
    createTriage: (payload: { complaint: string; issue_created: string; issue_priority: string; issue_type: string; issue_proj: string; horizon: 7 | 14; workload_records: { date: string; ticket_count: number }[]; ticketId?: string }) => request<TriageResult>('/predictions/triage', { method: 'POST', body: JSON.stringify(payload) }),
    list: (page = 1, pageSize = 20, modelId?: string) => request<PaginatedPredictions>(`/predictions?page=${page}&pageSize=${pageSize}${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ''}`),
    detail: (id: string) => request<{ prediction: Prediction }>(`/predictions/${id}`),
    remove: (id: string) => request<null>(`/predictions/${id}`, { method: 'DELETE' }),
  },
  tickets: {
    list: () => request<{ tickets: Ticket[] }>('/tickets'),
    get: (id: string) => request<{ ticket: Ticket }>(`/tickets/${id}`),
    create: (payload: { subject: string; description: string; category: string; priority: string; project: string }) => request<{ ticket: Ticket }>('/tickets', { method: 'POST', body: JSON.stringify(payload) }),
    respond: (id: string, payload: { message: string; visibility: 'public' | 'internal'; resolutionNote?: string }) => request<{ ticket: Ticket }>(`/tickets/${id}/responses`, { method: 'POST', body: JSON.stringify(payload) }),
    updateStatus: (id: string, payload: { status: string; resolutionNote?: string }) => request<{ ticket: Ticket }>(`/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify(payload) }),
    assign: (id: string, assigneeId: string) => request<{ ticket: Ticket }>(`/tickets/${id}/assignment`, { method: 'PATCH', body: JSON.stringify({ assigneeId }) }),
    updatePriority: (id: string, priority: string, note: string) => request<{ ticket: Ticket }>(`/tickets/${id}/priority`, { method: 'PATCH', body: JSON.stringify({ priority, note }) }),
    decideRecommendation: (id: string, payload: { decision: 'approved' | 'rejected' | 'modified'; action?: 'priority_review' | 'standard_queue'; note: string }) => request<{ ticket: Ticket }>(`/tickets/${id}/recommendation-decision`, { method: 'POST', body: JSON.stringify(payload) }),
    assignees: () => request<{ users: Array<{ id: string; name: string; email: string }> }>('/tickets/assignees'),
    users: () => request<{ users: Array<{ id: string; name: string; email: string; role: string; createdAt: string }> }>('/users'),
    uploadAttachment: async (ticketId: string, file: File) => {
      const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/attachments`, { method: 'POST', credentials: 'include', headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name) }, body: file });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) throw new ApiError(body.message ?? 'Attachment upload failed.', response.status, body.code);
      return body.data as { attachment: { id: string; fileName: string } };
    },
    downloadAttachment: async (ticketId: string, attachmentId: string) => {
      const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/attachments/${attachmentId}`, { credentials: 'include' });
      if (!response.ok) throw new ApiError('Attachment could not be downloaded.', response.status);
      return response.blob();
    },
  },
  capacityPlans: {
    list: () => request<{ plans: Array<{ _id: string; horizon: 7 | 14; expectedDemand: number; baselineCapacityPerDay: number; proposedCapacityPerDay: number; baselineUncovered: number; proposedUncovered: number; coverageImprovement: number; note: string; createdAt: string }> }>('/capacity-plans'),
    create: (payload: { ticketId: string; horizon: 7 | 14; baselineCapacityPerDay: number; proposedCapacityPerDay: number; note: string }) => request<{ plan: { expectedDemand: number; baselineCoverage: number; proposedCoverage: number; baselineUncovered: number; proposedUncovered: number; coverageImprovement: number } }>('/capacity-plans', { method: 'POST', body: JSON.stringify(payload) }),
  },
};
