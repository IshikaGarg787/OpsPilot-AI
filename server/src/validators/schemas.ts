import { z } from 'zod';

const dateString = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid creation timestamp.');

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters.').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid work email.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(128),
  termsAccepted: z.literal(true, { error: 'Accept the terms to create an account.' }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email.'),
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean().optional().default(false),
  expectedRole: z.enum(['customer', 'it_team', 'admin']).optional().default('customer'),
});

export const resolutionPredictionSchema = z.object({
  issue_created: dateString,
  issue_priority: z.string().trim().min(1).max(100),
  issue_type: z.string().trim().min(1).max(100),
  issue_proj: z.string().trim().min(1).max(200),
});

export const triagePipelineSchema = z.object({
  complaint: z.string().trim().min(8, 'Describe the customer complaint.').max(3000),
  ticketId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  issue_created: dateString,
  issue_priority: z.string().trim().min(1).max(100),
  issue_type: z.string().trim().min(1).max(100),
  issue_proj: z.string().trim().min(1).max(200),
  horizon: z.union([z.literal(7), z.literal(14)]),
  // The client reduces ticket uploads to small daily aggregates before sending them.
  workload_records: z.array(z.object({
    date: dateString,
    ticket_count: z.number().finite().int().nonnegative(),
  }).strict()).min(120).max(6000),
});

export const workloadForecastSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(250000),
  horizon: z.union([z.literal(7), z.literal(14)]),
});

export const profileSchema = z.object({ name: z.string().trim().min(2).max(100) });
export const preferenceSchema = z.object({ themePreference: z.enum(['light', 'dark', 'system']) });
export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(4).max(200),
  description: z.string().trim().min(8).max(5000),
  category: z.string().trim().min(1).max(100),
  priority: z.string().trim().min(1).max(100),
  project: z.string().trim().min(1).max(200),
});
export const customerTicketCreateSchema = z.object({
  subject: z.string().trim().min(4).max(200),
  description: z.string().trim().min(8).max(5000),
  category: z.literal('Assistance'),
}).strict();
export const customerTicketListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).optional(),
  status: z.enum(['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(),
});
export const ticketResponseSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  visibility: z.enum(['public', 'internal']).optional().default('public'),
  resolutionNote: z.string().trim().max(5000).optional(),
});
export const ticketStatusSchema = z.object({
  status: z.enum(['triaged', 'assigned', 'in_progress', 'waiting_customer', 'resolved', 'closed']),
  resolutionNote: z.string().trim().max(5000).optional(),
});
export const ticketAssignmentSchema = z.object({ assigneeId: z.string().regex(/^[a-f\d]{24}$/i) });
export const recommendationDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'modified']),
  action: z.enum(['priority_review', 'standard_queue']).optional(),
  note: z.string().trim().min(2).max(2000),
});
export const userRoleSchema = z.object({ role: z.enum(['customer', 'it_team']) });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  modelId: z.string().trim().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});
