const API = 'https://api.todoist.com/api/v1';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Sanitized error: never carries request headers, token, title or response body. */
export class TodoistError extends Error {
  constructor(code, { status = 0, retryAt = 0 } = {}) {
    super(code);
    this.name = 'TodoistError';
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export function normalizeTask(task, projects = {}) {
  if (!task || typeof task.id !== 'string' || typeof task.content !== 'string') {
    throw new TodoistError('INVALID_TASK');
  }
  return {
    id: task.id,
    title: task.content,
    projectId: task.project_id == null ? '' : String(task.project_id),
    projectName: projects[task.project_id] || '',
    parentId: task.parent_id == null ? null : String(task.parent_id),
    priority: task.priority || 1,
    due: task.due || null,
    revision: task.updated_at || null,
  };
}

export class TodoistClient {
  constructor({ fetch, getToken, now = () => Date.now(), gates = new Map() }) {
    this.fetch = fetch;
    this.getToken = getToken;
    this.now = now;
    this.gates = gates;
  }

  /** Bind one synchronization session to one credential, even if Settings changes. */
  createSession() {
    const token = this.getToken();
    return new TodoistClient({ fetch: this.fetch, getToken: () => token, now: this.now, gates: this.gates });
  }

  async request(path, { method = 'GET', body } = {}) {
    const token = this.getToken();
    if (typeof token !== 'string' || !token.trim()) throw new TodoistError('TOKEN_MISSING');
    let gate = this.gates.get(token);
    if (!gate) { gate = { retryAt: 0, authBlocked: false }; this.gates.set(token, gate); }
    if (gate.authBlocked) throw new TodoistError('AUTH');
    if (gate.retryAt > this.now()) throw new TodoistError('RATE_LIMIT', { retryAt: gate.retryAt });
    let response;
    try {
      response = await this.fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(body ? { body } : {}),
      });
    } catch {
      gate.retryAt = this.now() + 5000;
      throw new TodoistError('NETWORK', { retryAt: gate.retryAt });
    }
    const status = response.status;
    if (status < 200 || status >= 300) {
      let retryAt = 0;
      if (status === 429 || status >= 500) {
        const retry = response.headers && (typeof response.headers.get === 'function'
          ? response.headers.get('Retry-After')
          : response.headers['Retry-After'] || response.headers['retry-after']);
        const seconds = Number(retry);
        retryAt = retry && Number.isFinite(seconds)
          ? this.now() + Math.max(0, seconds * 1000)
          : Math.max(this.now() + 5000, Date.parse(retry) || 0);
      }
      if (retryAt) gate.retryAt = retryAt;
      if (status === 401 || status === 403) gate.authBlocked = true;
      throw new TodoistError(status === 401 || status === 403 ? 'AUTH' : status === 404
        ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'TEMPORARY' : 'REQUEST_REJECTED',
      { status, retryAt });
    }
    try { return await response.json(); } catch { throw new TodoistError('INVALID_RESPONSE'); }
  }

  async getUser() {
    const user = await this.request('/user');
    // Current /user is OIDC userinfo; accept the documented subject or legacy id.
    const accountId = user && (user.sub || user.id);
    if ((typeof accountId !== 'string' && typeof accountId !== 'number') || !String(accountId)) {
      throw new TodoistError('INVALID_ACCOUNT');
    }
    return { accountId: String(accountId) };
  }

  async paginate(path) {
    const results = new Map();
    const cursors = new Set();
    let cursor = null;
    do {
      const page = await this.request(`${path}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!page || !Array.isArray(page.results) || !hasOwn(page, 'next_cursor') ||
          (page.next_cursor !== null && typeof page.next_cursor !== 'string')) {
        throw new TodoistError('INVALID_PAGE');
      }
      for (const item of page.results) {
        if (!item || typeof item.id !== 'string') throw new TodoistError('INVALID_PAGE');
        results.set(item.id, item);
      }
      cursor = page.next_cursor;
      if (cursor !== null && (!cursor || cursors.has(cursor))) throw new TodoistError('CURSOR_LOOP');
      if (cursor) cursors.add(cursor);
    } while (cursor !== null);
    return Array.from(results.values());
  }

  getTasks() { return this.paginate('/tasks'); }
  getProjects() { return this.paginate('/projects'); }
  getTask(id) { return this.request(`/tasks/${encodeURIComponent(id)}`); }

  async runCommand(command) {
    const response = await this.request('/sync', {
      method: 'POST', body: `commands=${encodeURIComponent(JSON.stringify([command]))}`,
    });
    if (!response || !response.sync_status || !hasOwn(response.sync_status, command.uuid)) {
      throw new TodoistError('INVALID_RESPONSE');
    }
    return response.sync_status[command.uuid] === 'ok'
      ? { state: 'confirmed', code: 'OK' }
      : { state: 'conflict', code: 'API_REJECTED' };
  }
}
