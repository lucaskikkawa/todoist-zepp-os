import test from 'node:test';
import assert from 'node:assert/strict';
import { TodoistClient, TodoistError, normalizeTask } from '../../app-side/todoist-client.js';
import { OperationStore } from '../../app-side/operation-store.js';
import { SyncCoordinator } from '../../app-side/sync-coordinator.js';

const response = (body, status = 200, headers = {}) => ({ status, headers, json: async () => body });
const rawTask = (id, extra = {}) => ({ id, content: `Tarefa simulada ${id}`, project_id: 'p1', parent_id: null,
  priority: 1, due: null, updated_at: '2026-10-20T12:00:00Z', ...extra });
const operation = (task, id = task.id) => ({ uuid: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
  accountId: 'account-a', taskId: task.id, baseTask: normalizeTask(task), state: 'pending',
  command: { uuid: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, type: 'item_complete',
    args: { id: task.id, date_completed: '2026-10-20T12:30:00.000Z' } } });

function storage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function server(tasks = [rawTask('1')]) {
  const active = new Map(tasks.map((task) => [task.id, task]));
  const applied = new Set();
  const requests = [];
  let now = 100000;
  const state = { active, applied, requests, accountId: 'account-a', loseResponse: false, failCommand: null,
    fetch: async (url, opts) => {
      const parsed = new URL(url);
      requests.push({ path: parsed.pathname, query: parsed.search, opts });
      if (parsed.pathname.endsWith('/user')) return response({ sub: state.accountId });
      if (parsed.pathname.endsWith('/projects')) return response({ results: [{ id: 'p1', name: 'Pessoal' }], next_cursor: null });
      if (parsed.pathname.endsWith('/tasks')) return response({ results: Array.from(active.values()), next_cursor: null });
      if (parsed.pathname.endsWith('/sync')) {
        if (state.failCommand) return response({}, state.failCommand, { 'Retry-After': '10' });
        const command = JSON.parse(new URLSearchParams(opts.body).get('commands'))[0];
        if (!applied.has(command.uuid)) {
          applied.add(command.uuid);
          active.delete(command.args.id);
        }
        if (state.loseResponse) { state.loseResponse = false; throw new Error('network lost with sensitive upstream text'); }
        return response({ sync_status: { [command.uuid]: 'ok' } });
      }
      const task = active.get(decodeURIComponent(parsed.pathname.split('/').at(-1)));
      return task ? response(task) : response({}, 404);
    },
    now: () => now,
    advance: (ms) => { now += ms; },
  };
  return state;
}

function coordinator(remote, backing = storage()) {
  const client = new TodoistClient({ fetch: remote.fetch, getToken: () => 'SIMULATED_TOKEN_NOT_REAL', now: remote.now });
  const store = new OperationStore(backing);
  return { coordinator: new SyncCoordinator({ client, store, now: remote.now }), backing, store, client };
}

test('all pages include far-future and undated tasks; duplicate IDs deduplicate, cursors opaque', async () => {
  const seen = [];
  const client = new TodoistClient({ getToken: () => 'mock', fetch: async (url) => {
    seen.push(url);
    return response(seen.length === 1 ? { results: [rawTask('1')], next_cursor: 'opaque/+=' }
      : { results: [rawTask('1', { content: 'Atualizada' }), rawTask('2', { due: { date: '2030-01-01' } }), rawTask('3')], next_cursor: null });
  } });
  const tasks = await client.getTasks();
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].content, 'Atualizada');
  assert.match(seen[1], /cursor=opaque%2F%2B%3D/);
  assert.ok(seen.every((url) => !url.includes('filter')));
});

test('intermediate page failure rejects snapshot instead of exposing partial tasks', async () => {
  let call = 0;
  const client = new TodoistClient({ getToken: () => 'mock', fetch: async () => {
    call++;
    return call === 1 ? response({ results: [rawTask('1')], next_cursor: 'page2' }) : response({}, 503);
  } });
  await assert.rejects(client.getTasks(), { code: 'TEMPORARY' });
});

test('cursor loop rejects corrupt pagination', async () => {
  const client = new TodoistClient({ getToken: () => 'mock', fetch: async () => response({ results: [], next_cursor: 'same' }) });
  await assert.rejects(client.getTasks(), { code: 'CURSOR_LOOP' });
});

for (const count of [100, 1000, 5000]) {
  test(`paginated synthetic ${count} tasks loads every task without a product cutoff`, async () => {
    const tasks = Array.from({ length: count }, (_, index) => rawTask(String(index)));
    let calls = 0;
    const client = new TodoistClient({ getToken: () => 'mock', fetch: async (url) => {
      calls++;
      const cursor = Number(new URL(url).searchParams.get('cursor') || 0);
      const next = cursor + 200;
      return response({ results: tasks.slice(cursor, next), next_cursor: next < count ? String(next) : null });
    } });
    assert.equal((await client.getTasks()).length, count);
    assert.equal(calls, Math.ceil(count / 200));
  });
}

test('offline completion upload uses original date and persists ack before returning', async () => {
  const remote = server();
  const { coordinator: sync, backing } = coordinator(remote);
  const result = await sync.processOperations('account-a', [operation(rawTask('1'))]);
  assert.equal(result[0].state, 'confirmed');
  const stored = new OperationStore(backing).list()[0];
  assert.equal(stored.result.state, 'confirmed');
  assert.equal(stored.command.args.date_completed, '2026-10-20T12:30:00.000Z');
  assert.equal(remote.applied.size, 1);
});

test('lost HTTP response + Side Service restart retries immutable UUID without GET missing-task rejection', async () => {
  const remote = server();
  const { coordinator: first, backing } = coordinator(remote);
  const op = operation(rawTask('1'));
  remote.loseResponse = true;
  assert.equal((await first.processOperations('account-a', [op]))[0].state, 'retry');
  assert.equal(remote.active.size, 0);
  remote.advance(6000);
  const { coordinator: second } = coordinator(remote, backing);
  assert.equal((await second.processOperations('account-a', [op]))[0].state, 'confirmed');
  const writes = remote.requests.filter((request) => request.path.endsWith('/sync'));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].opts.body, writes[1].opts.body);
  assert.equal(remote.applied.size, 1);
});

test('Bluetooth ack loss retries persisted terminal response without another API command', async () => {
  const remote = server();
  const { coordinator: first, backing } = coordinator(remote);
  const op = operation(rawTask('1'));
  await first.processOperations('account-a', [op]);
  const { coordinator: restarted } = coordinator(remote, backing);
  assert.equal((await restarted.processOperations('account-a', [op]))[0].state, 'confirmed');
  assert.equal(remote.requests.filter((request) => request.path.endsWith('/sync')).length, 1);
});

test('same UUID with different immutable payload cannot reuse success acknowledgement', async () => {
  const remote = server();
  const { coordinator: sync } = coordinator(remote);
  const op = operation(rawTask('1'));
  await sync.processOperations('account-a', [op]);
  op.command.args.date_completed = '2026-10-21T00:00:00Z';
  await assert.rejects(sync.processOperations('account-a', [op]), { code: 'UUID_REUSED' });
});

test('partial sync keeps first success durable and later transient operation pending', async () => {
  const remote = server([rawTask('1'), rawTask('2')]);
  const original = remote.fetch;
  remote.fetch = async (url, opts) => {
    if (url.endsWith('/sync') && remote.applied.size === 1) return response({}, 503);
    return original(url, opts);
  };
  const { coordinator: sync, store } = coordinator(remote);
  const results = await sync.processOperations('account-a', [operation(rawTask('1')), operation(rawTask('2'))]);
  assert.deepEqual(results.map((result) => result.state), ['confirmed', 'retry']);
  assert.deepEqual(store.list().map((record) => record.result.state), ['confirmed', 'retry']);
});

test('Retry-After prevents another command until its deadline', async () => {
  const remote = server();
  const { coordinator: sync } = coordinator(remote);
  remote.failCommand = 429;
  const op = operation(rawTask('1'));
  const result = (await sync.processOperations('account-a', [op]))[0];
  assert.equal(result.code, 'RATE_LIMIT');
  remote.failCommand = null;
  await assert.rejects(sync.processOperations('account-a', [op]), { code: 'RATE_LIMIT' });
  assert.equal(remote.applied.size, 0);
  remote.advance(10001);
  assert.equal((await sync.processOperations('account-a', [op]))[0].state, 'confirmed');
});

test('global Retry-After gates identity, snapshot and a different queued operation', async () => {
  const remote = server([rawTask('1'), rawTask('2')]);
  const { coordinator: sync } = coordinator(remote);
  remote.failCommand = 429;
  await sync.processOperations('account-a', [operation(rawTask('1'))]);
  const requestCount = remote.requests.length;
  await assert.rejects(sync.identify(), { code: 'RATE_LIMIT' });
  await assert.rejects(sync.pullTasks('account-a'), { code: 'RATE_LIMIT' });
  await assert.rejects(sync.processOperations('account-a', [operation(rawTask('2'))]), { code: 'RATE_LIMIT' });
  assert.equal(remote.requests.length, requestCount);
});

test('invalid authentication suspends calls until token changes', async () => {
  let token = 'SIMULATED_BAD';
  let calls = 0;
  const client = new TodoistClient({ getToken: () => token, fetch: async () => {
    calls++;
    return calls === 1 ? response({}, 401) : response({ sub: 'account-a' });
  } });
  await assert.rejects(client.createSession().getUser(), { code: 'AUTH' });
  await assert.rejects(client.createSession().getUser(), { code: 'AUTH' });
  assert.equal(calls, 1);
  token = 'SIMULATED_CORRECTED';
  assert.equal((await client.createSession().getUser()).accountId, 'account-a');
  assert.equal(calls, 2);
});

test('either corrupt side slot retains latest acknowledged result', async () => {
  for (const slot of [0, 1]) {
    const remote = server();
    const { coordinator: sync, backing } = coordinator(remote);
    const op = operation(rawTask('1'));
    await sync.processOperations('account-a', [op]);
    backing.setItem(`pulso.operations.${slot}`, '{corrupt');
    const { coordinator: restarted, store } = coordinator(remote, backing);
    assert.equal(store.get('account-a', op.uuid).result.state, 'confirmed');
    assert.equal((await restarted.processOperations('account-a', [op]))[0].state, 'confirmed');
    assert.equal(remote.requests.filter((request) => request.path.endsWith('/sync')).length, 1);
  }
});

test('first-ever missing task remains conflict instead of claiming success', async () => {
  const remote = server([]);
  const { coordinator: sync } = coordinator(remote);
  const result = await sync.processOperations('account-a', [operation(rawTask('1'))]);
  assert.equal(result[0].state, 'conflict');
  assert.equal(result[0].code, 'REMOTE_MISSING');
  assert.equal(remote.applied.size, 0);
});

test('remote edits and active subtasks prevent unsafe parent completion', async () => {
  const remote = server([rawTask('1'), rawTask('2', { parent_id: '1' }), rawTask('3', { content: 'Changed remotely' })]);
  const { coordinator: sync } = coordinator(remote);
  const results = await sync.processOperations('account-a', [operation(rawTask('1')), operation(rawTask('3'))]);
  assert.deepEqual(results.map((result) => result.code), ['ACTIVE_SUBTASKS', 'REMOTE_CHANGED']);
  assert.equal(remote.applied.size, 0);
});

test('child completion followed by parent completion is safe and sequential', async () => {
  const parent = rawTask('1');
  const child = rawTask('2', { parent_id: '1' });
  const remote = server([parent, child]);
  const { coordinator: sync } = coordinator(remote);
  const results = await sync.processOperations('account-a', [operation(child), operation(parent)]);
  assert.deepEqual(results.map((result) => result.state), ['confirmed', 'confirmed']);
});

test('account mismatch cannot upload old-account operations', async () => {
  const remote = server();
  const { coordinator: sync } = coordinator(remote);
  remote.accountId = 'account-b';
  await assert.rejects(sync.processOperations('account-a', [operation(rawTask('1'))]), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(remote.requests.length, 1);
});

test('recurring events never replay archive or reschedule commands', async () => {
  const recurring = rawTask('1', { due: { date: '2026-10-20', string: 'every day', is_recurring: true } });
  const remote = server([recurring]);
  const { coordinator: sync } = coordinator(remote);
  const ops = Array.from({ length: 7 }, (_, index) => ({ ...operation(recurring, String(index)), command: null, state: 'blocked_recurring' }));
  const results = await sync.processOperations('account-a', ops);
  assert.ok(results.every((result) => result.state === 'blocked_recurring'));
  assert.equal(results.length, 7);
  assert.equal(remote.applied.size, 0);
  assert.equal(remote.active.get('1').due.date, '2026-10-20');
});

test('explicit conflict resolution is local and does not create an API command', async () => {
  const remote = server([]);
  const { coordinator: sync } = coordinator(remote);
  const op = operation(rawTask('1'));
  await sync.processOperations('account-a', [op]);
  assert.equal(sync.resolve('account-a', op.uuid).state, 'resolved');
  assert.equal((await sync.processOperations('account-a', [op]))[0].state, 'resolved');
  assert.equal(remote.applied.size, 0);
});

test('side store rejects both corrupt copies and verifies writes before sending', async () => {
  const remote = server();
  const backing = storage();
  backing.setItem('pulso.operations.0', '{broken');
  backing.setItem('pulso.operations.1', '{broken');
  assert.throws(() => new OperationStore(backing), /SIDE_STORE_CORRUPT/);
  const failing = storage();
  failing.setItem = () => {};
  const { coordinator: sync } = coordinator(remote, failing);
  await assert.rejects(sync.processOperations('account-a', [operation(rawTask('1'))]), /SIDE_STORE_WRITE/);
  assert.equal(remote.applied.size, 0);
});

test('missing token and raw fetch errors never expose credential or title', async () => {
  let calls = 0;
  const noToken = new TodoistClient({ getToken: () => '', fetch: async () => { calls++; } });
  await assert.rejects(noToken.getTasks(), { code: 'TOKEN_MISSING' });
  assert.equal(calls, 0);
  const client = new TodoistClient({ getToken: () => 'SENSITIVE_TOKEN', fetch: async () => {
    throw new Error('SENSITIVE_TOKEN and SENSITIVE_TITLE');
  } });
  try { await client.getTasks(); assert.fail('expected failure'); } catch (error) {
    assert.ok(error instanceof TodoistError);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /SENSITIVE_TOKEN|SENSITIVE_TITLE/);
  }
});

test('credential is captured for the session when settings changes mid-request', async () => {
  let token = 'SIMULATED_A';
  const used = [];
  const client = new TodoistClient({ getToken: () => token, fetch: async (_url, opts) => {
    used.push(opts.headers.Authorization);
    token = 'SIMULATED_B';
    return response({ sub: 'account-a' });
  } });
  const session = client.createSession();
  await session.getUser();
  await session.getUser();
  assert.deepEqual(used, ['Bearer SIMULATED_A', 'Bearer SIMULATED_A']);
});
