import { normalizeTask, TodoistError } from './todoist-client.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const commandKey = (op) => JSON.stringify({ taskId: op.taskId, command: op.command });
const resultOf = (record) => ({ uuid: record.uuid, ...record.result });
const terminal = new Set(['confirmed', 'conflict', 'resolved', 'blocked_recurring']);

function validateOperation(op, accountId) {
  if (!op || typeof op.uuid !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(op.uuid) ||
      op.accountId !== accountId || typeof op.taskId !== 'string' || !op.baseTask || op.baseTask.id !== op.taskId) return false;
  if (op.state === 'blocked_recurring' && op.command === null) return true;
  const c = op.command;
  return c && c.uuid === op.uuid && c.type === 'item_complete' && c.args && c.args.id === op.taskId &&
    Object.keys(c.args).sort().join(',') === 'date_completed,id' &&
    typeof c.args.date_completed === 'string' && /Z$/.test(c.args.date_completed) &&
    Number.isFinite(Date.parse(c.args.date_completed));
}

function sameTask(base, remote) {
  return base.id === remote.id && base.title === remote.title && base.projectId === remote.projectId &&
    base.parentId === remote.parentId && base.priority === remote.priority && base.revision === remote.revision &&
    JSON.stringify(base.due) === JSON.stringify(remote.due);
}

export class SyncCoordinator {
  constructor({ client, store, now = () => Date.now() }) {
    this.client = client;
    this.store = store;
    this.now = now;
    this.busy = false;
  }

  async identify() {
    const session = this.client.createSession();
    return session.getUser();
  }

  async session(accountId) {
    const session = this.client.createSession();
    const user = await session.getUser();
    if (user.accountId !== accountId) throw new TodoistError('ACCOUNT_MISMATCH');
    return session;
  }

  async processOperations(accountId, operations) {
    if (this.busy) throw new TodoistError('SYNC_BUSY');
    if (!Array.isArray(operations)) throw new TodoistError('INVALID_OPERATIONS');
    this.busy = true;
    try {
      const session = await this.session(accountId);
      const results = [];
      let active = null;
      const blockedTasks = new Set();
      for (const op of operations) {
        if (!validateOperation(op, accountId)) throw new TodoistError('INVALID_OPERATION');
        let record = this.store.get(accountId, op.uuid);
        if (record && record.commandKey !== commandKey(op)) throw new TodoistError('UUID_REUSED');
        if (record && terminal.has(record.result.state)) {
          results.push(resultOf(record));
          if (record.result.state !== 'confirmed' && record.result.state !== 'resolved') blockedTasks.add(op.taskId);
          continue;
        }
        if (!record) {
          record = { accountId, uuid: op.uuid, commandKey: commandKey(op),
            command: clone(op.command), taskId: op.taskId, sent: false, result: { state: 'retry', code: 'NOT_SENT' } };
        }
        const finish = (result) => {
          record.result = result;
          this.store.put(record);
          results.push(resultOf(record));
          if (result.state !== 'confirmed') blockedTasks.add(op.taskId);
        };
        if (op.state === 'blocked_recurring' || (op.baseTask.due && op.baseTask.due.is_recurring)) {
          finish({ state: 'blocked_recurring', code: 'RECURRING_HISTORY_UNSUPPORTED' });
          continue;
        }
        if (blockedTasks.has(op.taskId)) { finish({ state: 'conflict', code: 'DEPENDENCY_BLOCKED' }); continue; }
        if (record.result.retryAt > this.now()) { results.push(resultOf(record)); continue; }
        try {
          // Once sent, a vanished task is ambiguous. Replay the exact UUID/payload,
          // which Todoist deduplicates, instead of treating absence as success/failure.
          if (!record.sent) {
            if (!active) active = (await session.getTasks()).map((task) => normalizeTask(task));
            const remote = normalizeTask(await session.getTask(op.taskId));
            if (!sameTask(op.baseTask, remote)) { finish({ state: 'conflict', code: 'REMOTE_CHANGED' }); continue; }
            // item_complete also archives descendants. Require completion of children
            // first; never silently archive work the user has not completed.
            if (active.some((task) => task.parentId === op.taskId)) {
              finish({ state: 'conflict', code: 'ACTIVE_SUBTASKS' }); continue;
            }
            record.sent = true;
            record.result = { state: 'retry', code: 'IN_FLIGHT' };
            this.store.put(record);
          }
          const result = await session.runCommand(record.command);
          finish(result);
          if (result.state === 'confirmed' && active) active = active.filter((task) => task.id !== op.taskId);
        } catch (error) {
          if (!(error instanceof TodoistError)) throw error;
          const state = error.code === 'NOT_FOUND' && !record.sent ? 'conflict' : 'retry';
          finish({ state, code: error.code === 'NOT_FOUND' ? 'REMOTE_MISSING' : error.code,
            ...(error.retryAt ? { retryAt: error.retryAt } : {}) });
          // Do not hammer unavailable network/credentials or bypass Retry-After.
          if (error.code !== 'NOT_FOUND') break;
        }
      }
      return results;
    } finally { this.busy = false; }
  }

  async pullTasks(accountId) {
    const session = await this.session(accountId);
    const projects = {};
    for (const project of await session.getProjects()) projects[project.id] = project.name;
    const tasks = (await session.getTasks()).map((task) => normalizeTask(task, projects));
    return { accountId, tasks, syncedAt: new Date(this.now()).toISOString() };
  }

  /** Explicitly archive a conflict locally; never invent a fresh server command. */
  resolve(accountId, uuid) {
    const record = this.store.get(accountId, uuid);
    if (!record || !['conflict', 'blocked_recurring'].includes(record.result.state)) {
      throw new TodoistError('UNRESOLVABLE_OPERATION');
    }
    record.result = { state: 'resolved', code: 'KEPT_LOCAL_USE_REMOTE' };
    this.store.put(record);
    return resultOf(record);
  }
}
