export type QueueWorkloadRecord = {
  date: string;
  ticket_count: number;
  data_source: 'workspace' | 'simulated_bootstrap';
};

type DailyTicketCount = { _id: string; ticket_count: number };

function utcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function simulatedDailyCount(day: Date) {
  const weekday = day.getUTCDay();
  const base = weekday === 0 || weekday === 6 ? 4 : 15;
  const epochDay = Math.floor(day.getTime() / 86400000);
  const variation = ((epochDay * 7 + 3) % 9 + 9) % 9 - 4;
  return Math.max(0, base + variation);
}

/** Build a rolling daily series, using bootstrap values only before real history begins. */
export function buildQueueWorkloadHistory(
  dailyTicketCounts: DailyTicketCount[],
  firstTicketCreatedAt: Date | null,
  now = new Date(),
) {
  const today = utcDate(now);
  const start = new Date(today.getTime() - 119 * 86400000);
  const counts = new Map(dailyTicketCounts.map((row) => [row._id, row.ticket_count]));
  const firstObserved = firstTicketCreatedAt ? utcDate(firstTicketCreatedAt) : null;
  const actualStart = firstObserved
    ? firstObserved < start ? start : firstObserved > today ? null : firstObserved
    : null;

  const records: QueueWorkloadRecord[] = Array.from({ length: 120 }, (_, index) => {
    const day = new Date(start.getTime() + index * 86400000);
    const date = formatDate(day);
    const isWorkspaceHistory = actualStart !== null && day >= actualStart;
    return {
      date,
      ticket_count: isWorkspaceHistory ? counts.get(date) ?? 0 : simulatedDailyCount(day),
      data_source: isWorkspaceHistory ? 'workspace' : 'simulated_bootstrap',
    };
  });

  const actualRecords = records.filter((record) => record.data_source === 'workspace');
  return {
    records,
    windowDays: records.length,
    actualTicketCount: actualRecords.reduce((total, record) => total + record.ticket_count, 0),
    actualDays: actualRecords.length,
    syntheticDays: records.length - actualRecords.length,
    firstActualDate: actualRecords[0]?.date ?? null,
    lastActualDate: actualRecords.at(-1)?.date ?? null,
    todayIsPartial: true,
  };
}
