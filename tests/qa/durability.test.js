import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceStore } from '../../shared/domain/device-store.js';

class FaultFilesystem {
  constructor(seed = []) { this.files = new Map(seed); this.failure = null; }
  read(name) { return this.files.get(name) ?? null; }
  write(name, text) {
    if (this.failure && this.failure(name)) {
      this.files.set(name, text.slice(0, Math.floor(text.length / 2)));
      throw new Error('SIMULATED_POWER_LOSS');
    }
    this.files.set(name, text);
  }
  remove(name) { this.files.delete(name); }
}
const task = (id, extra = {}) => ({ id, content: `Sintética ${id}`, project_id: 'p', updated_at: 'r1', ...extra });
let qaUuidCounter = 0;
function store(fs) {
  return createDeviceStore(fs, { now: () => new Date('2026-10-20T13:00:00.000Z'), uuid: () => `qa-${++qaUuidCounter}` });
}
function generation(device, id, tasks, accountId = 'a') {
  device.beginGeneration({ id, accountId, blockCount: 1, count: tasks.length });
  device.stageBlock(id, 0, tasks);
  device.activateGeneration(id);
}

test('QA: every acknowledged completion survives corruption of either queue mirror', () => {
  const fs = new FaultFilesystem();
  const device = store(fs);
  generation(device, 'g1', [task('1')]);
  const event = device.completeTask('1');
  for (const name of ['queue-a.json', 'queue-b.json']) {
    const damaged = new FaultFilesystem(fs.files);
    damaged.files.set(name, '{corrupt');
    const recovered = store(damaged);
    assert.equal(recovered.history()[0].id, event.id);
    assert.equal(recovered.pendingOperations().length, 1);
    assert.equal(recovered.getTask('1'), null);
  }
});

test('QA: torn first or second completion write never loses an earlier acknowledged event', () => {
  for (const failAt of [1, 2]) {
    const fs = new FaultFilesystem();
    const device = store(fs);
    generation(device, 'g1', [task('1'), task('2')]);
    const first = device.completeTask('1');
    let writes = 0;
    fs.failure = (name) => name.startsWith('queue-') && ++writes === failAt;
    assert.throws(() => device.completeTask('2'));
    fs.failure = null;
    const recovered = store(fs);
    assert.ok(recovered.history().some((event) => event.id === first.id));
    const previous = recovered.pendingOperations().find((op) => op.taskId === '2');
    recovered.completeTask('2');
    const pending = recovered.pendingOperations().filter((op) => op.taskId === '2');
    assert.equal(pending.length, 1);
    if (previous) assert.deepEqual(pending[0].command, previous.command);
  }
});

test('QA: corruption of all queue copies fails explicitly and preserves files', () => {
  const fs = new FaultFilesystem([['queue-a.json', 'bad-a'], ['queue-b.json', 'bad-b']]);
  assert.throws(() => store(fs), { code: 'QUEUE_CORRUPT' });
  assert.deepEqual([...fs.files], [['queue-a.json', 'bad-a'], ['queue-b.json', 'bad-b']]);
});

test('QA: torn staged block and corrupt newest cache retain last valid generation', () => {
  const fs = new FaultFilesystem();
  const device = store(fs);
  generation(device, 'g1', [task('1')]);
  device.beginGeneration({ id: 'g2', accountId: 'a', blockCount: 1, count: 1 });
  fs.failure = (name) => name === 'tasks-g2-0.json';
  assert.throws(() => device.stageBlock('g2', 0, [task('2')]));
  fs.failure = null;
  assert.equal(store(fs).getTask('1').id, '1');
  generation(device, 'g3', [task('3')]);
  fs.files.set('tasks-g3-0.json', 'corrupted');
  const recovered = store(fs);
  assert.equal(recovered.metadata().generation, 'g1');
  assert.equal(recovered.getTask('1').id, '1');
});

test('QA: account replacement is blocked even when all cached task manifests are absent', () => {
  const fs = new FaultFilesystem();
  const device = store(fs);
  generation(device, 'g1', [task('1')]);
  device.completeTask('1');
  fs.files.delete('tasks-a.json');
  fs.files.delete('tasks-b.json');
  const recovered = store(fs);
  assert.throws(() => generation(recovered, 'g2', [task('2')], 'b'), { code: 'ACCOUNT_MISMATCH' });
  assert.equal(recovered.pendingOperations()[0].accountId, 'a');
});

test('QA: seven offline daily events retain original UTC/local dates and cannot be acknowledged as remote success', () => {
  const fs = new FaultFilesystem();
  const device = store(fs);
  generation(device, 'g1', [task('1', { due: { date: '2026-10-20', string: 'todos os dias', is_recurring: true } })]);
  for (let day = 20; day < 27; day++) {
    const event = device.completeTask('1', { completedAt: `2026-10-${day}T02:00:00.000Z`, localDate: `2026-10-${day}`, timezoneOffsetMinutes: 180, timezone: 'America/Sao_Paulo' });
    assert.equal(device.completeTask('1', { completedAt: `2026-10-${day}T03:00:00.000Z`, localDate: `2026-10-${day}` }).id, event.id);
  }
  const recovered = store(fs);
  assert.equal(recovered.history().length, 7);
  assert.equal(new Set(recovered.history().map((event) => event.completedAt)).size, 7);
  assert.equal(recovered.getTask('1').due.date, '2026-10-27');
  assert.ok(recovered.pendingOperations().every((op) => op.command === null && op.state === 'blocked_recurring'));
  assert.throws(() => recovered.applyResults([{ uuid: recovered.pendingOperations()[0].uuid, state: 'confirmed' }]), { code: 'RECURRING_REPLAY_BLOCKED' });
  assert.equal(store(fs).history().length, 7);
});
