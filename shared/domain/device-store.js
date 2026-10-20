import { checkedWrite, clone, decode, fail } from '../storage/integrity.js';
import { Journal } from '../storage/journal.js';
import { normalizeTask, taskGroup } from './tasks.js';
import { dateInLocalTimezone, isRecurring, isSimpleDaily, nextDailyDate } from '../recurrence/daily.js';

function defaultUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 3) | 8).toString(16);
  });
}
function safeId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value); }
function validManifest(value) {
  return value && value.version === 1 && safeId(value.id) && typeof value.accountId === 'string' &&
    Number.isSafeInteger(value.sequence) && Number.isSafeInteger(value.count) && value.count >= 0 &&
    Array.isArray(value.blocks) && value.blocks.every((block) => Number.isSafeInteger(block.count) && typeof block.name === 'string');
}

export function createDeviceStore(fs, options = {}) {
  return new DeviceStore(fs, options);
}

export class DeviceStore {
  constructor(fs, { now = () => new Date(), uuid = defaultUuid, readOnly = false } = {}) {
    this.fs = fs; this.now = now; this.uuid = uuid;
    this.readOnly = readOnly;
    this.readOnlyReason = null;
    try {
      this.journal = new Journal(fs);
    } catch (error) {
      if (!readOnly) throw error;
      // Corrupt queue files remain untouched. Raw cached tasks are still useful
      // for consultation, but their local completion overlay cannot be trusted.
      this.readOnlyReason = error.code || 'QUEUE_UNREADABLE';
      this.journal = { state: { version: 1, sequence: 0, accountId: null, completions: [], operations: [] } };
    }
    this.staging = null;
    this.recoveryWarning = null;
    this.manifest = this.recoverManifest();
  }
  assertWritable() { if (this.readOnly) fail('READ_ONLY_CACHE'); }
  recoverManifest() {
    const raws = [this.fs.read('tasks-a.json'), this.fs.read('tasks-b.json')];
    const candidates = raws.map(decode).filter(validManifest).sort((a, b) => b.sequence - a.sequence);
    for (const manifest of candidates) {
      try {
        this.validateGeneration(manifest);
        if (this.journal.state.accountId && manifest.accountId !== this.journal.state.accountId) continue;
        if (manifest !== candidates[0]) this.recoveryWarning = 'CACHE_RECOVERED';
        return manifest;
      } catch { this.recoveryWarning = 'CACHE_RECOVERED'; }
    }
    if (raws.some((raw) => raw !== null && raw !== undefined)) this.recoveryWarning = 'CACHE_CORRUPT';
    return null;
  }
  readBlock(block) {
    const payload = decode(this.fs.read(block.name));
    if (!payload || payload.version !== 1 || !Array.isArray(payload.tasks) || payload.tasks.length !== block.count) fail('CACHE_CORRUPT');
    return payload.tasks;
  }
  validateGeneration(manifest) {
    let count = 0;
    const ids = new Set();
    manifest.blocks.forEach((block) => {
      this.readBlock(block).forEach((task) => {
        normalizeTask(task);
        if (ids.has(task.id)) fail('DUPLICATE_TASK');
        ids.add(task.id); count += 1;
      });
    });
    if (count !== manifest.count) fail('INCOMPLETE_GENERATION');
    return ids;
  }
  metadata() {
    return {
      accountId: this.journal.state.accountId || (this.manifest && this.manifest.accountId) || null,
      generation: this.manifest ? this.manifest.id : null,
      count: this.manifest ? this.manifest.count : 0,
      lastSync: this.manifest ? this.manifest.syncedAt : null,
      recoveryWarning: this.recoveryWarning,
      readOnly: this.readOnly,
      readOnlyReason: this.readOnlyReason
    };
  }
  beginGeneration({ id, accountId, blockCount, count, syncedAt }) {
    this.assertWritable();
    if (!safeId(id) || !accountId || typeof accountId !== 'string' || !Number.isSafeInteger(blockCount) || blockCount < 0 || !Number.isSafeInteger(count) || count < 0) fail('INVALID_GENERATION');
    const bound = this.metadata().accountId;
    if (bound && bound !== accountId) fail('ACCOUNT_MISMATCH');
    // IDs are immutable: never overwrite blocks belonging to a committed generation.
    const existing = ['tasks-a.json', 'tasks-b.json'].map((name) => decode(this.fs.read(name))).filter(validManifest);
    if (existing.some((manifest) => manifest.id === id)) fail('GENERATION_EXISTS');
    const abandoned = decode(this.fs.read('tasks-staging.json'));
    if (abandoned && safeId(abandoned.id) && Number.isSafeInteger(abandoned.blockCount) && abandoned.blockCount >= 0 && !existing.some((manifest) => manifest.id === abandoned.id)) {
      for (let index = 0; index < abandoned.blockCount; index += 1) this.fs.remove(`tasks-${abandoned.id}-${index}.json`);
    }
    // Persist the deterministic block range before the first block is written.
    // Interrupted transfers can then be reclaimed without listing the filesystem.
    checkedWrite(this.fs, 'tasks-staging.json', { id, blockCount });
    this.staging = { version: 1, id, accountId, blockCount, count, syncedAt: syncedAt || this.now().toISOString(), blocks: [] };
  }
  stageBlock(id, index, tasks) {
    this.assertWritable();
    const staging = this.staging;
    if (!staging || staging.id !== id || !Number.isSafeInteger(index) || index < 0 || index >= staging.blockCount || !Array.isArray(tasks)) fail('INVALID_BLOCK');
    const normalized = tasks.map(normalizeTask);
    const block = { name: `tasks-${id}-${index}.json`, count: normalized.length };
    checkedWrite(this.fs, block.name, { version: 1, tasks: normalized });
    staging.blocks[index] = block;
  }
  activateGeneration(id) {
    this.assertWritable();
    const staging = this.staging;
    if (!staging || staging.id !== id || staging.blocks.length !== staging.blockCount || staging.blocks.some((block) => !block)) fail('INCOMPLETE_GENERATION');
    // Sparse arrays are checked explicitly; Array#some skips holes.
    for (let index = 0; index < staging.blockCount; index += 1) if (!staging.blocks[index]) fail('INCOMPLETE_GENERATION');
    const activeIds = this.validateGeneration(staging);
    const next = clone(staging);
    // An observed absence lets a later reappearance count as reopening even
    // when a remote record has no revision. Bind this evidence to the cache.
    const absent = new Set(this.manifest && this.manifest.observedAbsent ? this.manifest.observedAbsent : []);
    this.journal.state.completions.forEach((event) => {
      const operation = this.journal.state.operations.find((op) => op.uuid === event.operationUuid);
      if (operation && operation.state === 'confirmed' && !activeIds.has(event.taskId)) absent.add(event.id);
    });
    next.observedAbsent = Array.from(absent);
    delete next.blockCount;
    next.sequence = (this.manifest ? this.manifest.sequence : 0) + 1;
    if (!this.journal.state.accountId) this.journal.commit((state) => { state.accountId = next.accountId; });
    const name = next.sequence % 2 ? 'tasks-a.json' : 'tasks-b.json';
    const displaced = decode(this.fs.read(name));
    checkedWrite(this.fs, name, next);
    this.manifest = next;
    this.staging = null;
    this.recoveryWarning = null;
    try { this.fs.remove('tasks-staging.json'); } catch { /* Next begin ignores committed IDs. */ }
    // Only the generation displaced from the third slot is eligible for deletion.
    if (validManifest(displaced) && displaced.id !== next.id) displaced.blocks.forEach((block) => {
      try { this.fs.remove(block.name); } catch { /* Cleanup failure does not invalidate committed data. */ }
    });
    return this.metadata();
  }
  forEachTask(callback) {
    if (!this.manifest) return;
    this.manifest.blocks.forEach((block) => this.readBlock(block).forEach(callback));
  }
  rawTask(id) {
    let found = null;
    this.forEachTask((task) => { if (task.id === String(id)) found = task; });
    return found ? clone(found) : null;
  }
  effectiveTask(task) {
    const events = this.journal.state.completions.filter((event) => event.taskId === task.id && !event.resolved);
    if (!events.length) return task;
    if (!isRecurring(task)) {
      const hidden = events.some((event) => {
        const operation = this.journal.state.operations.find((op) => op.uuid === event.operationUuid);
        return !operation || operation.state !== 'confirmed' || event.confirmedGenerationSequence === undefined ||
          !this.manifest || this.manifest.sequence <= event.confirmedGenerationSequence ||
          (task.revision === event.originalRevision && !(this.manifest.observedAbsent || []).includes(event.id));
      });
      return hidden ? null : task;
    }
    const latest = events[events.length - 1];
    if (!latest.nextDue) return null;
    // Never mask a recurrence change received from another client.
    if (JSON.stringify(latest.originalDue) !== JSON.stringify(task.due)) return task;
    return { ...task, due: { ...task.due, date: latest.nextDue } };
  }
  getTask(id) { const task = this.rawTask(id); return task ? this.effectiveTask(task) : null; }
  listTasks({ group, offset = 0, limit = 20, timezoneOffsetMinutes = this.now().getTimezoneOffset(), today = dateInLocalTimezone(this.now().toISOString(), timezoneOffsetMinutes) } = {}) {
    const tasks = []; let count = 0;
    this.forEachTask((raw) => {
      const task = this.effectiveTask(raw);
      if (!task || (group && taskGroup(task, today, timezoneOffsetMinutes) !== group)) return;
      if (count >= offset && tasks.length < limit) tasks.push(task);
      count += 1;
    });
    return { tasks, total: count, offset, hasMore: offset + tasks.length < count };
  }
  completeTask(id, context = {}) {
    this.assertWritable();
    const task = this.getTask(id);
    if (!task) {
      const previous = this.journal.state.completions.find((event) => event.taskId === String(id) && !event.resolved);
      if (previous) return clone(previous);
      fail('TASK_NOT_FOUND');
    }
    let hasChildren = false;
    this.forEachTask((child) => { if (child.parentId === task.id && this.effectiveTask(child)) hasChildren = true; });
    if (hasChildren) fail('HAS_ACTIVE_SUBTASKS');
    if (!this.metadata().accountId) fail('ACCOUNT_UNBOUND');
    const instant = context.completedAt || this.now().toISOString();
    const completedAt = new Date(instant).toISOString();
    const offset = context.timezoneOffsetMinutes === undefined ? new Date(instant).getTimezoneOffset() : context.timezoneOffsetMinutes;
    const localDate = context.localDate || dateInLocalTimezone(completedAt, offset);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) fail('INVALID_LOCAL_DATE');
    const previous = this.journal.state.completions.filter((event) => event.taskId === task.id && !event.resolved);
    if (isRecurring(task) && previous.some((event) => event.localDate === localDate)) return clone(previous[previous.length - 1]);
    const original = this.rawTask(task.id);
    const nextDue = isSimpleDaily(task) ? nextDailyDate(task.due.date) : null;
    const eventId = this.uuid();
    const uuid = this.uuid();
    const event = {
      id: eventId, taskId: task.id, title: task.title, accountId: this.metadata().accountId,
      occurrence: task.due ? clone(task.due) : null, originalDue: original.due,
      originalRevision: original.revision, completedAt, localDate,
      timezone: context.timezone || null, timezoneOffsetMinutes: offset,
      nextDue, recurring: isRecurring(task), operationUuid: uuid, resolved: false
    };
    const operation = {
      uuid, taskId: task.id, accountId: event.accountId, completionId: eventId,
      command: isRecurring(task) ? null : { type: 'item_complete', uuid, args: { id: task.id, date_completed: completedAt } },
      baseTask: original, state: isRecurring(task) ? 'blocked_recurring' : 'pending'
    };
    this.journal.commit((state) => { state.completions.push(event); state.operations.push(operation); });
    return clone(event);
  }
  pendingOperations() { return clone(this.journal.state.operations.filter((operation) => !['confirmed', 'resolved'].includes(operation.state))); }
  history({ offset = 0, limit = 50 } = {}) {
    return clone(this.journal.state.completions.slice().reverse().slice(offset, offset + limit).map((event) => {
      const operation = this.journal.state.operations.find((op) => op.uuid === event.operationUuid);
      return { ...event, state: operation ? operation.state : 'unknown' };
    }));
  }
  applyResults(results) {
    this.assertWritable();
    if (!Array.isArray(results)) fail('INVALID_RESULTS');
    const allowed = ['confirmed', 'conflict', 'retry', 'blocked_recurring', 'resolved'];
    this.journal.commit((state) => {
      results.forEach((result) => {
        const operation = state.operations.find((op) => op.uuid === result.uuid);
        if (!operation || !allowed.includes(result.state)) return;
        if (operation.state === 'confirmed' || operation.state === 'resolved') return;
        if (operation.command === null && result.state === 'confirmed') fail('RECURRING_REPLAY_BLOCKED');
        operation.state = result.state;
        operation.result = clone(result);
        if (result.state === 'confirmed') {
          const event = state.completions.find((item) => item.id === operation.completionId);
          if (event) event.confirmedGenerationSequence = this.manifest ? this.manifest.sequence : 0;
        }
        if (result.state === 'resolved') {
          const event = state.completions.find((item) => item.id === operation.completionId);
          if (event) event.resolved = true;
        }
      });
    });
  }
}
