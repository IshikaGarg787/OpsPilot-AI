import { TicketModel } from '../models/Ticket.js';

export interface ResolutionTicketContext {
  _id?: unknown;
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  project: string;
}

interface ResolvedTicketContext extends ResolutionTicketContext {
  responses?: Array<{ resolutionNote?: string }>;
}

export interface ResolutionRecommendation {
  source: 'similar_resolved_ticket' | 'troubleshooting_playbook';
  title: string;
  summary: string;
  steps: string[];
  verification: string;
  escalation: string;
  precedent?: { ticketNumber: string; resolution: string };
}

const stopWords = new Set(['about', 'after', 'also', 'and', 'are', 'can', 'could', 'from', 'have', 'into', 'issue', 'just', 'need', 'please', 'that', 'the', 'this', 'ticket', 'with', 'your', 'you']);

function normalizeWords(value: string) {
  return new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((word) => !stopWords.has(word)));
}

function similarityScore(current: ResolutionTicketContext, previous: ResolutionTicketContext) {
  const currentWords = normalizeWords(`${current.subject} ${current.description} ${current.category} ${current.project}`);
  const previousWords = normalizeWords(`${previous.subject} ${previous.description} ${previous.category} ${previous.project}`);
  const union = new Set([...currentWords, ...previousWords]);
  const overlap = [...currentWords].filter((word) => previousWords.has(word)).length;
  const textSimilarity = union.size ? overlap / union.size : 0;
  const categoryMatch = current.category.trim().toLowerCase() === previous.category.trim().toLowerCase();
  const projectMatch = current.project.trim().toLowerCase() === previous.project.trim().toLowerCase();
  return textSimilarity * 0.5 + (categoryMatch ? 0.3 : 0) + (projectMatch ? 0.2 : 0);
}

function cleanText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[number redacted]')
    .trim()
    .slice(0, 900);
}

function issueKind(ticket: ResolutionTicketContext) {
  const text = `${ticket.category} ${ticket.subject} ${ticket.description}`.toLowerCase();
  if (/network|connection|connectivity|vpn|dns|wifi|wi-fi|internet/.test(text)) return 'network';
  if (/access|login|log in|permission|account|authentication|sign in|sso/.test(text)) return 'access';
  if (/hardware|laptop|desktop|printer|monitor|keyboard|device|power/.test(text)) return 'hardware';
  if (/report|export|data|sync|import|dashboard|record/.test(text)) return 'data';
  if (/bug|error|crash|software|application|browser|app|exception/.test(text)) return 'software';
  return 'general';
}

const playbooks: Record<string, { title: string; summary: string; steps: string[] }> = {
  access: {
    title: 'Check account access safely',
    summary: 'Start by confirming who is affected and which service or permission is failing.',
    steps: [
      'Confirm the affected user, service, exact error, and when access last worked.',
      'Check that the account is active and has the expected team or role membership.',
      'Review sign-in or authorization logs around the reported time; keep any request or correlation ID.',
      'Test the expected access with an approved least-privilege account. Do not share or request passwords.',
    ],
  },
  network: {
    title: 'Isolate the connection issue',
    summary: 'Find out whether this affects one device, one network, or multiple users before changing configuration.',
    steps: [
      'Record the affected users, devices, location, connection type, and time the issue began.',
      'Check whether the service has a known incident and whether other approved services are reachable.',
      'Compare the result on a known-working device or approved network, without changing security settings.',
      'Capture the exact error and relevant DNS, VPN, or connection diagnostics for the network owner.',
    ],
  },
  hardware: {
    title: 'Run basic device checks',
    summary: 'Verify the device and its immediate connections before arranging repair or replacement.',
    steps: [
      'Confirm the asset, device model, location, affected user, and any visible error indicator.',
      'Check power, cables, and peripherals; where safe, compare with a known-working cable or port.',
      'Run the organization-approved device diagnostic and note its result or error code.',
      'If there is heat, damage, an electrical smell, or a battery warning, stop using the device and escalate to hardware support.',
    ],
  },
  data: {
    title: 'Trace the data or report path',
    summary: 'Check the requested data range and the last successful refresh before rerunning a job.',
    steps: [
      'Confirm the report, date range, filters, expected result, and who is affected.',
      'Check source-data freshness and the user’s existing access to that source.',
      'Review import, synchronization, or report-job status and capture the first relevant error.',
      'Compare a small known record or previous successful run before retrying a larger operation.',
    ],
  },
  software: {
    title: 'Reproduce and isolate the software issue',
    summary: 'Capture a repeatable example and identify whether the problem is tied to a user, version, or recent change.',
    steps: [
      'Write down the exact steps, expected result, actual result, time, and affected users.',
      'Capture the error or request ID and check application health and recent deployment or configuration changes.',
      'Compare with a known-working account or supported browser/version, preserving the original evidence.',
      'Use a safe test environment to confirm a suspected fix before applying it to production.',
    ],
  },
  general: {
    title: 'Start with a safe diagnostic checklist',
    summary: 'Gather enough evidence to narrow the cause before changing a system.',
    steps: [
      'Confirm the affected service, user or device, business impact, and when the issue started.',
      'Record the exact steps to reproduce the issue and the full error message or request ID.',
      'Check service health and recent changes, then compare with a known-working user or environment.',
      'Try only an approved, reversible diagnostic step and record the outcome before making a change.',
    ],
  },
};

export function buildFallbackRecommendation(ticket: ResolutionTicketContext): ResolutionRecommendation {
  return {
    source: 'troubleshooting_playbook',
    ...playbooks[issueKind(ticket)],
    verification: 'Confirm the original issue is resolved with the affected user and check that related service health is normal.',
    escalation: 'If the issue persists or a step could affect production, stop and escalate with the ticket number, timestamps, exact error, and checks already completed.',
  };
}

export function buildResolutionRecommendation(ticket: ResolutionTicketContext, previousTickets: ResolvedTicketContext[]): ResolutionRecommendation {
  const precedent = previousTickets
    .map((previous) => ({ previous, score: similarityScore(ticket, previous), note: previous.responses?.slice().reverse().find((response) => response.resolutionNote?.trim())?.resolutionNote }))
    .filter((match): match is typeof match & { note: string } => Boolean(match.note?.trim()))
    .sort((a, b) => b.score - a.score)[0];

  if (!precedent || precedent.score < 0.3) return buildFallbackRecommendation(ticket);
  return {
    source: 'similar_resolved_ticket',
    title: 'Check a similar resolved ticket',
    summary: 'A resolved ticket from your own IT work has matching issue context. Treat its resolution as a lead to verify, not as a guaranteed fix.',
    steps: [
      'Compare the affected service, environment, and error with the prior ticket before reusing its approach.',
      'Follow the prior resolution only if the same cause is present and the action is approved for this environment.',
      'If the symptoms differ, use the safe diagnostic checks below and do not repeat a production change blindly.',
    ],
    verification: 'Ask the affected user to repeat the original workflow and confirm the issue no longer occurs.',
    escalation: 'If the prior fix does not apply or the issue remains, escalate with both ticket references and the new diagnostic evidence.',
    precedent: { ticketNumber: precedent.previous.ticketNumber, resolution: cleanText(precedent.note) },
  };
}

export async function recommendResolution(ticket: ResolutionTicketContext, userId: unknown) {
  const previousTickets = await TicketModel.find({
    $and: [
      { $or: [{ assignedTo: userId }, { ownerUserId: userId, ownerRole: 'it_team' }] },
      { status: { $in: ['resolved', 'closed'] } },
      ...(ticket._id ? [{ _id: { $ne: ticket._id } }] : []),
    ],
  }).select('ticketNumber subject description category project responses').sort({ updatedAt: -1 }).limit(100).lean();
  return buildResolutionRecommendation(ticket, previousTickets as unknown as ResolvedTicketContext[]);
}
