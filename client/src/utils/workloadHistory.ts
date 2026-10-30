export interface DailyWorkloadRecord {
  date: string;
  ticket_count: number;
}

export function dailyRecordsCsv(records: DailyWorkloadRecord[]): string {
  return ['date,ticket_count', ...records.map(({ date, ticket_count }) => `${date},${ticket_count}`)].join('\n');
}

export function blankWorkloadTemplate(startDate: string, days = 180): string {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(start)) throw new Error('A valid template start date is required.');
  return ['date,ticket_count', ...Array.from({ length: days }, (_, index) => `${new Date(start + index * 86400000).toISOString().slice(0, 10)},`)].join('\n');
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
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names. Keep one date and one ticket_count column.');
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function aggregateWorkloadHistory(rows: Record<string, string>[]): DailyWorkloadRecord[] {
  const counts = new Map<string, number>();
  const add = (date: string, count: number) => counts.set(date, (counts.get(date) ?? 0) + count);

  for (const row of rows) {
    if (row.date !== undefined && row.ticket_count !== undefined) {
      const day = row.date.trim();
      const dateMs = Date.parse(`${day}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== day) throw new Error('Daily CSV rows need valid calendar dates in YYYY-MM-DD format.');
      if (!row.ticket_count.trim()) throw new Error(`Enter ticket_count for ${day}; leave zero as 0 when no tickets arrived.`);
      const count = Number(row.ticket_count);
      if (!Number.isInteger(count) || count < 0) throw new Error('Daily CSV rows need whole, non-negative ticket_count values.');
      add(day, count);
    } else if (row.issue_created) {
      const time = Date.parse(row.issue_created);
      if (!Number.isFinite(time)) throw new Error('Every ticket row must have a valid issue_created timestamp.');
      add(new Date(time).toISOString().slice(0, 10), 1);
    } else throw new Error('CSV needs issue_created, or date and ticket_count columns.');
  }

  const sorted = [...counts].sort(([a], [b]) => a.localeCompare(b));
  if (!sorted.length) throw new Error('No support ticket dates were found in this CSV.');
  const first = Date.parse(`${sorted[0][0]}T00:00:00Z`);
  const last = Date.parse(`${sorted.at(-1)![0]}T00:00:00Z`);
  const days = Math.floor((last - first) / 86400000) + 1;
  if (days < 120) throw new Error('The history must span at least 120 calendar days.');
  const dailyCounts = new Map(sorted);
  return Array.from({ length: days }, (_, index) => { const date = new Date(first + index * 86400000).toISOString().slice(0, 10); return { date, ticket_count: dailyCounts.get(date) ?? 0 }; });
}
