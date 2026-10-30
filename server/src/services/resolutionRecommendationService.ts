export interface ResolutionTicketContext {
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  project: string;
}

export interface ResolutionRecommendation {
  source: 'troubleshooting_playbook';
  title: string;
  summary: string;
  steps: string[];
  verification: string;
  escalation: string;
}

function issueKind(ticket: ResolutionTicketContext) {
  const text = `${ticket.category} ${ticket.subject} ${ticket.description}`.toLowerCase();
  if (/network|connection|connectivity|vpn|dns|wifi|wi-fi|internet/.test(text)) return 'network';
  if (/analytics|workspace|data portal|reporting workspace/.test(text) && /access|permission|role|grant|entitlement|cannot open|can't open|unable to open/.test(text)) return 'workspace_access';
  if (/access|login|log in|permission|account|authentication|sign in|sso/.test(text)) return 'access';
  if (/hardware|laptop|desktop|printer|monitor|keyboard|device|power/.test(text)) return 'hardware';
  if (/report|export|data|sync|import|dashboard|record/.test(text)) return 'data';
  if (/bug|error|crash|software|application|browser|app|exception/.test(text)) return 'software';
  return 'general';
}

const playbooks: Record<string, { title: string; summary: string; steps: string[] }> = {
  workspace_access: {
    title: 'Restore analytics workspace access',
    summary: 'Check the user’s workspace membership and approved role, then correct only the missing entitlement.',
    steps: [
      'Confirm the requester’s account, the exact analytics workspace, and the role they need; check that the request has data-owner approval.',
      'Check the account is active and compare its workspace group or role with a teammate who has the approved access.',
      'If the approved group is missing, add the user to that group or provision the requested least-privilege role; do not grant workspace-admin access as a shortcut.',
      'Have the user sign out and back in to refresh SSO. If membership is already correct, inspect the workspace authorization or provisioning event at the reported time.',
    ],
  },
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

export function recommendResolution(ticket: ResolutionTicketContext) {
  return buildFallbackRecommendation(ticket);
}
