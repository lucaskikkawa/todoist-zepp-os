import { clone, fail } from '../storage/integrity.js';

export function normalizeTask(input) {
  if (!input || (typeof input.id !== 'string' && typeof input.id !== 'number')) fail('INVALID_TASK');
  const title = input.title === undefined ? input.content : input.title;
  if (typeof title !== 'string' || !String(input.id)) fail('INVALID_TASK');
  return {
    id: String(input.id), title,
    projectId: input.projectId === undefined ? String(input.project_id || '') : String(input.projectId),
    projectName: input.projectName || '',
    parentId: input.parentId === undefined ? (input.parent_id ? String(input.parent_id) : null) : (input.parentId ? String(input.parentId) : null),
    priority: Number(input.priority) || 1,
    due: input.due ? clone(input.due) : null,
    revision: input.revision === undefined ? (input.updated_at || null) : input.revision
  };
}

export function dueDate(task, timezoneOffsetMinutes = new Date().getTimezoneOffset()) {
  if (!task.due) return null;
  const value = String(task.due.datetime || task.due.date || '');
  // Date-only and floating times are calendar values, not UTC instants. A
  // documented explicit ISO offset, however, must be displayed on the watch's
  // local day even if Todoist's source timezone has a different calendar date.
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const instant = new Date(value).getTime();
    if (Number.isFinite(instant) && Number.isFinite(timezoneOffsetMinutes)) {
      return new Date(instant - timezoneOffsetMinutes * 60000).toISOString().slice(0, 10);
    }
  }
  return value.slice(0, 10) || null;
}

export function taskGroup(task, today, timezoneOffsetMinutes) {
  const date = dueDate(task, timezoneOffsetMinutes);
  if (!date) return 'no_date';
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}
