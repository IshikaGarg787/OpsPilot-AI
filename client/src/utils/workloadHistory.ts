export const SUPPORT_ISSUE_TYPES = new Set(['Ticket', 'Service', 'HD Service']);

export interface DailyWorkloadRecord {
  date: string;
  ticket_count: number;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('Choose a CSV with a header and ticket history.');
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function aggregateWorkloadHistory(rows: Record<string, string>[]): DailyWorkloadRecord[] {
  const counts = new Map<string, number>();
  const hasIssueType = rows.some((row) => Object.prototype.hasOwnProperty.call(row, 'issue_type'));
  const add = (date: string, count: number) => counts.set(date, (counts.get(date) ?? 0) + count);

  for (const row of rows) {
    if (row.date !== undefined && row.ticket_count !== undefined) {
      const day = row.date.trim().slice(0, 10);
      const count = Number(row.ticket_count);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(count) || count < 0) throw new Error('Daily CSV rows need valid date and whole, non-negative ticket_count values.');
      add(day, count);
    } else if (row.issue_created) {
      if (hasIssueType && !SUPPORT_ISSUE_TYPES.has((row.issue_type ?? '').trim())) continue;
      const time = Date.parse(row.issue_created);
      if (!Number.isFinite(time)) throw new Error('Every ticket row must have a valid issue_created timestamp.');
      add(new Date(time).toISOString().slice(0, 10), 1);
    } else throw new Error('CSV needs issue_created, or date and ticket_count columns.');
  }

  const records = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([date, ticket_count]) => ({ date, ticket_count }));
  if (records.length < 120) throw new Error('The history must cover at least 120 days.');
  if ((Date.parse(records.at(-1)!.date) - Date.parse(records[0].date)) / 86400000 < 119) throw new Error('The history must span at least 120 calendar days.');
  return records;
}
