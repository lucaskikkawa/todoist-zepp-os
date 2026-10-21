export function isRecurring(task) { return Boolean(task.due && task.due.is_recurring); }

export function isSimpleDaily(task) {
  const due = task.due;
  if (!due || !due.is_recurring || due.datetime || !/^\d{4}-\d{2}-\d{2}$/.test(due.date || '')) return false;
  // Strict allowlist. Relative (!), interval, weekday and timed rules remain blocked.
  const text = String(due.string || '').trim().toLowerCase();
  return ['every day', 'daily', 'todos os dias', 'todo dia', 'diariamente'].indexOf(text) !== -1;
}

export function nextDailyDate(date) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function dateInLocalTimezone(instant, offsetMinutes) {
  return new Date(new Date(instant).getTime() - offsetMinutes * 60000).toISOString().slice(0, 10);
}
