import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceStore } from '../../shared/domain/device-store.js';
import { checksum, decode } from '../../shared/storage/integrity.js';
import { taskGroup } from '../../shared/domain/tasks.js';
import { MemoryFs, fixtureTask } from '../helpers/memory-fs.js';

function setup() {
  const fs = new MemoryFs(); let id = 0;
  const options = { now: () => new Date('2026-10-20T12:00:00.000Z'), uuid: () => `uuid-${++id}` };
  return { fs, options, store: createDeviceStore(fs, options) };
}
function install(store, tasks, id = 'generation-1', accountId = 'account-1', size = 20) {
  store.beginGeneration({ id, accountId, blockCount: Math.ceil(tasks.length / size), count: tasks.length });
  for (let i = 0; i < tasks.length; i += size) store.stageBlock(id, i / size, tasks.slice(i, i + size));
  store.activateGeneration(id);
}

test('cache includes future and undated tasks, preserves due data and survives restart', () => {
  const { fs, options, store } = setup();
  const tasks = [fixtureTask(1, { due: { date: '2026-10-19' } }), fixtureTask(2, { due: { date: '2026-10-20' } }), fixtureTask(3, { due: { date: '2030-01-01' } }), fixtureTask(4)];
  install(store, tasks);
  const restarted = createDeviceStore(fs, options);
  assert.equal(restarted.metadata().count, 4);
  ['overdue', 'today', 'upcoming', 'no_date'].forEach((group) => assert.equal(restarted.listTasks({ group }).total, 1));
  assert.equal(restarted.getTask('3').due.date, '2030-01-01');
});

test('task generation requires every block and correct count; incomplete transfer leaves old cache', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  store.beginGeneration({ id: 'generation-2', accountId: 'account-1', blockCount: 2, count: 2 });
  store.stageBlock('generation-2', 1, [fixtureTask(3)]);
  assert.throws(() => store.activateGeneration('generation-2'), /INCOMPLETE_GENERATION/);
  assert.equal(createDeviceStore(fs, options).getTask('1').id, '1');
  store.stageBlock('generation-2', 0, [fixtureTask(2)]);
  store.activateGeneration('generation-2');
  assert.equal(store.getTask('1'), null);
  assert.equal(store.metadata().count, 2);
});

test('corrupted latest chunk recovers preceding complete generation', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]); install(store, [fixtureTask(2)], 'generation-2');
  fs.files.set('tasks-generation-2-0.json', 'broken');
  const recovered = createDeviceStore(fs, options);
  assert.equal(recovered.getTask('1').id, '1');
  assert.equal(recovered.metadata().recoveryWarning, 'CACHE_RECOVERED');
});

test('committed generation cannot be overwritten by a retry', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  assert.throws(() => store.beginGeneration({ id: 'generation-1', accountId: 'account-1', count: 1, blockCount: 1 }), /GENERATION_EXISTS/);
  assert.equal(createDeviceStore(fs, options).getTask('1').id, '1');
});

test('duplicate task IDs or count mismatch reject snapshot without replacing cache', () => {
  const { store } = setup(); install(store, [fixtureTask(1)]);
  store.beginGeneration({ id: 'bad', accountId: 'account-1', blockCount: 1, count: 2 });
  store.stageBlock('bad', 0, [fixtureTask(2), fixtureTask(2)]);
  assert.throws(() => store.activateGeneration('bad'), /DUPLICATE_TASK/);
  assert.equal(store.metadata().generation, 'generation-1');
});

test('offline completion persists before return, deduplicates touches and survives restart', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  const event = store.completeTask('1', { timezone: 'America/Sao_Paulo', timezoneOffsetMinutes: 180 });
  const duplicate = store.completeTask('1');
  assert.equal(duplicate.id, event.id);
  assert.equal(store.getTask('1'), null);
  const restarted = createDeviceStore(fs, options);
  assert.equal(restarted.getTask('1'), null);
  assert.equal(restarted.history().length, 1);
  const operation = restarted.pendingOperations()[0];
  assert.equal(operation.command.uuid, operation.uuid);
  assert.equal(operation.command.args.date_completed, '2026-10-20T12:00:00.000Z');
  assert.equal(restarted.history()[0].timezoneOffsetMinutes, 180);
});

test('each queue copy independently recovers the last acknowledged event', () => {
  ['queue-a.json', 'queue-b.json'].forEach((name) => {
    const { fs, options, store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]);
    store.completeTask('1'); store.completeTask('2');
    fs.files.set(name, '{corrupt');
    assert.equal(createDeviceStore(fs, options).history().length, 2);
  });
});

test('both corrupt queue copies fail closed rather than presenting an empty queue', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]); store.completeTask('1');
  fs.files.set('queue-a.json', 'bad'); fs.files.set('queue-b.json', 'bad');
  assert.throws(() => createDeviceStore(fs, options), /QUEUE_CORRUPT/);
});

test('torn first queue write never reports completion; verified mirror survives', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  fs.tearAt = fs.writes + 1;
  assert.throws(() => store.completeTask('1'), /STORAGE_WRITE_FAILED/);
  const recovered = createDeviceStore(fs, options);
  assert.equal(recovered.history().length, 0);
  assert.equal(recovered.getTask('1').id, '1');
});

test('interruption during mirror does not duplicate recovered completion on retry', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  fs.failAt = fs.writes + 2;
  assert.throws(() => store.completeTask('1'), /SIMULATED_DISK_FULL/);
  const recovered = createDeviceStore(fs, options);
  assert.equal(recovered.history().length, 1);
  recovered.completeTask('1');
  assert.equal(recovered.history().length, 1);
});

test('disk full staging generation preserves old cache and existing queue', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]); store.completeTask('1');
  store.beginGeneration({ id: 'generation-2', accountId: 'account-1', blockCount: 1, count: 1 });
  fs.failAt = fs.writes + 1;
  assert.throws(() => store.stageBlock('generation-2', 0, [fixtureTask(3)]), /SIMULATED_DISK_FULL/);
  const recovered = createDeviceStore(fs, options);
  assert.equal(recovered.getTask('2').id, '2');
  assert.equal(recovered.history().length, 1);
});

test('results persist individually, retry leaves immutable command and confirmed history', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]);
  store.completeTask('1'); store.completeTask('2');
  const [first, second] = store.pendingOperations();
  store.applyResults([{ uuid: first.uuid, state: 'confirmed' }, { uuid: second.uuid, state: 'retry', code: 'NETWORK' }]);
  const restarted = createDeviceStore(fs, options);
  assert.equal(restarted.pendingOperations().length, 1);
  assert.deepEqual(restarted.pendingOperations()[0].command, second.command);
  assert.equal(restarted.history().length, 2);
  assert.equal(restarted.history().filter((event) => event.state === 'confirmed').length, 1);
});

test('account mismatch refuses new generation with unsent events preserved', () => {
  const { store } = setup(); install(store, [fixtureTask(1)]); store.completeTask('1');
  assert.throws(() => store.beginGeneration({ id: 'account-change', accountId: 'account-2', blockCount: 0, count: 0 }), /ACCOUNT_MISMATCH/);
  assert.equal(store.pendingOperations().length, 1);
});

test('seven daily offline occurrences retain original dates and never produce replay commands', () => {
  const { fs, options, store } = setup();
  install(store, [fixtureTask(1, { due: { date: '2026-10-20', string: 'todos os dias', is_recurring: true } })]);
  for (let day = 20; day <= 26; day += 1) {
    const completedAt = `2026-10-${day}T22:00:00.000Z`;
    store.completeTask('1', { completedAt, timezoneOffsetMinutes: 180 });
    store.completeTask('1', { completedAt, timezoneOffsetMinutes: 180 });
  }
  const restarted = createDeviceStore(fs, options);
  assert.equal(restarted.history().length, 7);
  assert.equal(restarted.getTask('1').due.date, '2026-10-27');
  assert.equal(restarted.history()[6].occurrence.date, '2026-10-20');
  assert.equal(restarted.history()[0].occurrence.date, '2026-10-26');
  assert.ok(restarted.pendingOperations().every((operation) => operation.command === null && operation.state === 'blocked_recurring'));
  assert.throws(() => restarted.applyResults([{ uuid: restarted.pendingOperations()[0].uuid, state: 'confirmed' }]), /RECURRING_REPLAY_BLOCKED/);
});

test('unsupported recurrence preserves event without inventing next date', () => {
  const { store } = setup(); install(store, [fixtureTask(1, { due: { date: '2026-10-20', string: 'every weekday', is_recurring: true } })]);
  store.completeTask('1'); store.completeTask('1');
  assert.equal(store.history().length, 1);
  assert.equal(store.history()[0].nextDue, null);
  assert.equal(store.getTask('1'), null);
  assert.equal(store.pendingOperations()[0].state, 'blocked_recurring');
});

test('timed daily recurrence remains blocked without approximate timezone arithmetic', () => {
  const { store } = setup(); install(store, [fixtureTask(1, { due: { date: '2026-10-20T12:00:00', datetime: '2026-10-20T15:00:00Z', timezone: 'America/Sao_Paulo', string: 'every day', is_recurring: true } })]);
  store.completeTask('1');
  assert.equal(store.history()[0].nextDue, null);
});

test('UTC instant and local day crossing midnight are preserved', () => {
  const { store } = setup(); install(store, [fixtureTask(1)]);
  const event = store.completeTask('1', { completedAt: '2026-10-21T01:00:00Z', timezoneOffsetMinutes: 180, timezone: 'America/Sao_Paulo' });
  assert.equal(event.completedAt, '2026-10-21T01:00:00.000Z');
  assert.equal(event.localDate, '2026-10-20');
});

test('date-only, floating and zoned due payloads survive normalization', () => {
  const { store } = setup();
  const dueValues = [{ date: '2026-10-20' }, { date: '2026-10-20T10:00:00', timezone: null }, { date: '2026-10-20', datetime: '2026-10-20T13:00:00Z', timezone: 'America/Sao_Paulo' }];
  install(store, dueValues.map((due, index) => fixtureTask(index, { due })));
  dueValues.forEach((due, index) => assert.deepEqual(store.getTask(String(index)).due, due));
});

test('parent completion waits for active children; children remain durably recorded', () => {
  const { store } = setup(); install(store, [fixtureTask(1), fixtureTask(2, { parentId: '1' })]);
  assert.throws(() => store.completeTask('1'), /HAS_ACTIVE_SUBTASKS/);
  store.completeTask('2'); store.completeTask('1');
  assert.equal(store.history().length, 2);
  assert.deepEqual(store.pendingOperations().map((op) => op.taskId), ['2', '1']);
});

test('sync completion does not drop newer offline events or overwrite their overlay', () => {
  const { store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]);
  store.completeTask('1'); const first = store.pendingOperations()[0];
  store.beginGeneration({ id: 'generation-2', accountId: 'account-1', blockCount: 1, count: 2 });
  store.stageBlock('generation-2', 0, [fixtureTask(1), fixtureTask(2)]);
  store.completeTask('2');
  store.applyResults([{ uuid: first.uuid, state: 'confirmed' }]);
  store.activateGeneration('generation-2');
  assert.equal(store.pendingOperations().length, 1);
  assert.equal(store.listTasks().total, 0);
});

for (const count of [100, 1000, 5000]) {
  test(`simulated ${count} task volume installs, pages and recovers without truncation`, (context) => {
    const { fs, options, store } = setup();
    const start = performance.now();
    install(store, Array.from({ length: count }, (_, index) => fixtureTask(index)), `volume-${count}`);
    const restarted = createDeviceStore(fs, options);
    const last = restarted.listTasks({ offset: count - 3, limit: 20 });
    assert.equal(last.total, count);
    assert.equal(last.tasks.length, 3);
    assert.equal(last.tasks[2].id, String(count - 1));
    restarted.completeTask(String(count - 1));
    assert.equal(restarted.listTasks().total, count - 1);
    context.diagnostic(`${count} tasks: ${(performance.now() - start).toFixed(1)} ms; ${Array.from(fs.files.values()).reduce((sum, text) => sum + text.length, 0)} UTF-16 code units persisted in simulated fs`);
  });
}

test('checksum detects payload tampering', () => {
  assert.notEqual(checksum('one'), checksum('two'));
  assert.equal(decode('{bad'), null);
});

test('task date grouping does not filter distant future', () => {
  assert.equal(taskGroup(fixtureTask(1, { due: { date: '2040-01-01' } }), '2026-10-20'), 'upcoming');
});

test('interrupted stage blocks are reclaimed on next transfer, with committed cache protected', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  store.beginGeneration({ id: 'abandoned', accountId: 'account-1', blockCount: 2, count: 2 });
  store.stageBlock('abandoned', 0, [fixtureTask(2)]);
  const restarted = createDeviceStore(fs, options);
  restarted.beginGeneration({ id: 'next-stage', accountId: 'account-1', blockCount: 0, count: 0 });
  assert.equal(fs.read('tasks-abandoned-0.json'), null);
  assert.equal(restarted.getTask('1').id, '1');
});

test('new remote recurrence date stays visible without replacing it with stale local advance', () => {
  const { store } = setup();
  const recurring = fixtureTask(1, { due: { date: '2026-10-20', is_recurring: true, string: 'every day' }, revision: null });
  install(store, [recurring]); store.completeTask('1');
  install(store, [{ ...recurring, due: { ...recurring.due, date: '2026-11-01' } }], 'remote-change');
  assert.equal(store.getTask('1').due.date, '2026-11-01');
  assert.equal(store.history().length, 1);
});

test('a confirmed ordinary completion does not hide a task reopened in a later remote snapshot', () => {
  const { store } = setup(); install(store, [fixtureTask(1)]); store.completeTask('1');
  const operation = store.pendingOperations()[0];
  store.applyResults([{ uuid: operation.uuid, state: 'confirmed' }]);
  assert.equal(store.getTask('1'), null);
  install(store, [fixtureTask(1, { revision: 'reopened' })], 'reopened-snapshot');
  assert.equal(store.getTask('1').id, '1');
  store.completeTask('1', { completedAt: '2026-10-21T12:00:00Z' });
  assert.equal(store.history().length, 2);
  assert.equal(store.pendingOperations().length, 1);
});

test('null revision remains hidden through stale snapshots, but absent then reappearing task can reopen', () => {
  const { store } = setup(); const task = fixtureTask(1, { revision: null });
  install(store, [task]); store.completeTask('1');
  store.applyResults([{ uuid: store.pendingOperations()[0].uuid, state: 'confirmed' }]);
  install(store, [task], 'stale-null-revision');
  assert.equal(store.getTask('1'), null);
  install(store, [], 'remote-absent');
  install(store, [task], 'remote-reappeared');
  assert.equal(store.getTask('1').id, '1');
});

test('zoned due timestamps group by watch local day near UTC midnight without mutating payload', () => {
  const { store } = setup();
  const dueValues = [
    { date: '2026-10-21', datetime: '2026-10-21T01:00:00Z', timezone: 'UTC' },
    { date: '2026-10-21T01:00:00+00:00', timezone: 'UTC' },
    { date: '2026-10-21T03:30:00+03:00', timezone: 'Europe/Moscow' },
    { date: '2026-10-20T22:30:00-03:00', timezone: 'America/Sao_Paulo' }
  ];
  install(store, dueValues.map((due, index) => fixtureTask(index, { due })));
  const local = store.listTasks({ group: 'today', today: '2026-10-20', timezoneOffsetMinutes: 180 });
  assert.equal(local.total, 4);
  dueValues.forEach((due, index) => assert.deepEqual(store.getTask(index).due, due));
  assert.equal(store.listTasks({ group: 'upcoming', today: '2026-10-20', timezoneOffsetMinutes: 0 }).total, 4);
});

test('date-only and floating timed tasks keep calendar date across watch offsets', () => {
  const { store } = setup();
  install(store, [
    fixtureTask(1, { due: { date: '2026-10-21' } }),
    fixtureTask(2, { due: { date: '2026-10-21T01:00:00', timezone: null } }),
    fixtureTask(3, { due: { date: '2026-10-21', datetime: '2026-10-21T01:00:00', timezone: null } })
  ]);
  assert.equal(store.listTasks({ group: 'upcoming', today: '2026-10-20', timezoneOffsetMinutes: 180 }).total, 3);
  assert.equal(store.listTasks({ group: 'upcoming', today: '2026-10-20', timezoneOffsetMinutes: -540 }).total, 3);
  assert.equal(taskGroup(fixtureTask(4, { due: { datetime: '2026-10-20T23:30:00Z' } }), '2026-10-21', -540), 'today');
});

test('read-only fallback consults valid cache with corrupt queue while preserving every file', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]); store.completeTask('1');
  fs.files.set('queue-a.json', '{corrupt-a'); fs.files.set('queue-b.json', '{corrupt-b');
  const originalFiles = Array.from(fs.files.entries());
  const originalWrites = fs.writes;
  assert.throws(() => createDeviceStore(fs, options), /QUEUE_CORRUPT/);
  const readonly = createDeviceStore(fs, { ...options, readOnly: true });
  assert.equal(readonly.metadata().readOnly, true);
  assert.equal(readonly.metadata().readOnlyReason, 'QUEUE_CORRUPT');
  assert.equal(readonly.metadata().accountId, 'account-1');
  assert.equal(readonly.listTasks().total, 2);
  assert.equal(readonly.getTask('2').title, 'Tarefa 2');
  assert.throws(() => readonly.completeTask('2'), /READ_ONLY_CACHE/);
  assert.throws(() => readonly.beginGeneration({ id: 'blocked', accountId: 'account-1', blockCount: 0, count: 0 }), /READ_ONLY_CACHE/);
  assert.throws(() => readonly.stageBlock('blocked', 0, []), /READ_ONLY_CACHE/);
  assert.throws(() => readonly.activateGeneration('blocked'), /READ_ONLY_CACHE/);
  assert.throws(() => readonly.applyResults([]), /READ_ONLY_CACHE/);
  assert.deepEqual(Array.from(fs.files.entries()), originalFiles);
  assert.equal(fs.writes, originalWrites);
});

test('explicit read-only mode can use valid local completion overlays without permitting writes', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]); store.completeTask('1');
  const readonly = createDeviceStore(fs, { ...options, readOnly: true });
  assert.equal(readonly.listTasks().total, 1);
  assert.equal(readonly.history().length, 1);
  assert.throws(() => readonly.completeTask('2'), /READ_ONLY_CACHE/);
});

test('list grouping derives default today from supplied watch timezone offset', () => {
  const fs = new MemoryFs();
  const store = createDeviceStore(fs, { now: () => new Date('2026-10-21T01:00:00Z') });
  install(store, [fixtureTask(1, { due: { date: '2026-10-20' } })]);
  assert.equal(store.listTasks({ group: 'today', timezoneOffsetMinutes: 180 }).total, 1);
});

test('reseeded UUID generator cannot reuse durable event or command IDs after restart', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1), fixtureTask(2)]); store.completeTask('1');
  const filesBefore = Array.from(fs.files.entries());
  let id = 0;
  const restarted = createDeviceStore(fs, { ...options, uuid: () => `uuid-${++id}` });
  assert.throws(() => restarted.completeTask('2'), /UUID_COLLISION/);
  assert.equal(restarted.history().length, 1);
  assert.equal(restarted.pendingOperations().length, 1);
  assert.equal(restarted.getTask('2').id, '2');
  assert.deepEqual(Array.from(fs.files.entries()), filesBefore);
});

test('completion and operation IDs must differ even within the first event', () => {
  const { fs, options, store } = setup(); install(store, [fixtureTask(1)]);
  const duplicateGenerator = createDeviceStore(fs, { ...options, uuid: () => 'same-id' });
  assert.throws(() => duplicateGenerator.completeTask('1'), /UUID_COLLISION/);
  assert.equal(duplicateGenerator.history().length, 0);
});
