// This is a Node-host smoke test of actual application entrypoints with mocked
// Zepp APIs. It is deliberately NOT a Zepp simulator/hardware integration test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const state = globalThis.__pulsoQaHost = {
  files: new Map(),
  unreadable: new Set(),
  instant: '2026-10-21T02:15:30.500Z',
  local: [2026, 10, 20, 23, 15, 30],
  app: null, pages: [], side: null, settingsPage: null, settings: new Map(), widgets: [], routes: [],
};
const sources = {
  '@zeppos/zml/base-app': 'export const BaseApp = options => options;',
  '@zeppos/zml/base-page': 'export const BasePage = options => options;',
  '@zeppos/zml/base-side': `export const BaseSideService = options => options;
    export const settingsLib = {
      getItem: key => globalThis.__pulsoQaHost.settings.get(key) ?? null,
      setItem: (key,value) => globalThis.__pulsoQaHost.settings.set(key,value),
      removeItem: key => globalThis.__pulsoQaHost.settings.delete(key)
    };`,
  '@zos/router': `export const push = route => globalThis.__pulsoQaHost.routes.push(route); export const back = () => {};`,
  '@zos/ui': `export const widget = { TEXT: 'TEXT', BUTTON: 'BUTTON' };
    export const align = { LEFT: 0, CENTER_V: 1 }; export const text_style = { WRAP: 1 };
    export function createWidget(type, props) { const item = {type,props}; globalThis.__pulsoQaHost.widgets.push(item); return item; }
    export function deleteWidget(item) { const list=globalThis.__pulsoQaHost.widgets; const i=list.indexOf(item); if(i>=0) list.splice(i,1); }
    export function getTextLayout(text, props) { return {height: Math.ceil(text.length / Math.max(1,Math.floor(props.text_width / (props.text_size/2)))) * props.text_size}; }
  `,
  '@zos/sensor': `export class Time {
    getTime(){ return Date.parse(globalThis.__pulsoQaHost.instant); }
    getFullYear(){ return globalThis.__pulsoQaHost.local[0]; }
    getMonth(){ return globalThis.__pulsoQaHost.local[1]; }
    getDate(){ return globalThis.__pulsoQaHost.local[2]; }
    getHours(){ return globalThis.__pulsoQaHost.local[3]; }
    getMinutes(){ return globalThis.__pulsoQaHost.local[4]; }
    getSeconds(){ return globalThis.__pulsoQaHost.local[5]; }
  }`,
  '@zos/fs': `const s = globalThis.__pulsoQaHost;
    export function readFileSync({path,options}) {
      if(options.encoding!=='utf8') throw Error('ENCODING');
      return s.unreadable.has(path) ? undefined : s.files.get(path);
    }
    export function writeFileSync({path,data,options}) {
      if(options.encoding!=='utf8') throw Error('ENCODING'); s.files.set(path,data);
    }
    export function statSync({path}) { return s.files.has(path) ? {size:s.files.get(path).length} : undefined; }
    export function rmSync({path}) { s.files.delete(path); return 0; }
    export function readdirSync() { return [...s.files.keys()]; }
  `,
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(sources, specifier)) return { url: `qa-zepp:${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('qa-zepp:')) return { format: 'module', source: sources[url.slice(8)], shortCircuit: true };
    return nextLoad(url, context);
  },
});
globalThis.App = (options) => { state.app = options; };
globalThis.getApp = () => ({ _options: state.app });

await import('../../app.js');
const { watchContext } = await import('../../shared/adapters/watch-clock.js');
const { zeppFs } = await import('../../shared/adapters/zepp-fs.js');

test('QA Zepp host mock: UTC instant/local day and UTC-03 offset stay distinct at midnight', () => {
  assert.deepEqual(watchContext(), {
    completedAt: '2026-10-21T02:15:30.500Z', localDate: '2026-10-20',
    timezone: 'UTC-03:00', timezoneOffsetMinutes: 180,
  });
});

test('QA Zepp host mock: unreadable existing file is an error, absent file is null', () => {
  assert.equal(zeppFs.read('absent'), null);
  state.files.set('unreadable', 'valid-data');
  state.unreadable.add('unreadable');
  assert.throws(() => zeppFs.read('unreadable'), { code: 'STORAGE_READ_FAILED' });
  state.unreadable.clear(); state.files.delete('unreadable');
});

test('QA Zepp host mock: actual App cold start loads local journal before any network', () => {
  state.app.onCreate();
  assert.equal(state.app.globalData.storageError, null);
  const store = state.app.globalData.store;
  assert.equal(store.metadata().count, 0);
  store.beginGeneration({ id: 'host-1', accountId: 'a', blockCount: 1, count: 1 });
  store.stageBlock('host-1', 0, [{ id: '1', content: 'Tarefa local sintética' }]);
  store.activateGeneration('host-1');
  store.completeTask('1', watchContext());
  state.app.onCreate();
  const reopened = state.app.globalData.store;
  assert.notEqual(reopened, store);
  assert.equal(reopened.history()[0].completedAt, '2026-10-21T02:15:30.500Z');
  assert.equal(reopened.history()[0].localDate, '2026-10-20');
  assert.equal(reopened.pendingOperations().length, 1);
  assert.equal(reopened.getTask('1'), null);
});

globalThis.Page = (options) => { state.pages.push(options); };
globalThis.AppSideService = (options) => { state.side = options; };
globalThis.AppSettingsPage = (options) => { state.settingsPage = options; };
for (const name of ['View', 'Text', 'TextInput', 'Button']) globalThis[name] = (props, children) => ({ component: name, props, children });
await import('../../page/tasks/index.js');
await import('../../page/detail/index.js');
await import('../../page/pending/index.js');
await import('../../page/history/index.js');
await import('../../setting/index.js');
await import('../../app-side/index.js');

const findButton = (label) => state.widgets.find((item) => item.type === 'BUTTON' && item.props.text === label);

test('QA Zepp host mock: Settings never renders persisted token and accepts replacement only on phone', () => {
  const storage = { getItem: (key) => state.settings.get(key) ?? null, setItem: (key,value) => state.settings.set(key,value), removeItem: (key) => state.settings.delete(key) };
  state.settings.set('pulso.token', 'SIMULATED_PHONE_SECRET');
  const settings = state.settingsPage.build({ settingsStorage: storage });
  assert.doesNotMatch(JSON.stringify(settings), /SIMULATED_PHONE_SECRET/);
  const input = settings.children.find((node) => node.component === 'TextInput');
  assert.equal(input.props.value, '');
  input.props.onChange('SIMULATED_REPLACEMENT');
  assert.equal(state.settings.get('pulso.token'), 'SIMULATED_PHONE_SECRET');
  settings.children.find((node) => node.component === 'Button' && node.props.label === 'Salvar token').props.onClick();
  assert.equal(state.settings.get('pulso.token'), 'SIMULATED_REPLACEMENT');
  assert.doesNotMatch(JSON.stringify(state.settingsPage.build({ settingsStorage: storage })), /SIMULATED_REPLACEMENT/);
});

test('QA Zepp host mock: actual Side native fetch wrapper, task page and detail complete/sync end to end', async () => {
  state.files.clear(); state.app.onCreate();
  const remote = new Map([['2', { id: '2', content: 'Tarefa futura sintética', project_id: 'p', priority: 1, parent_id: null,
    updated_at: 'r1', due: { date: '2035-01-01' } }]]);
  const commands = [];
  state.side.fetch = async (options) => {
    assert.equal(typeof options, 'object');
    assert.match(options.headers.Authorization, /^Bearer /);
    const path = new URL(options.url).pathname;
    let body;
    if (path.endsWith('/user')) body = { sub: 'a' };
    else if (path.endsWith('/projects')) body = { results: [{ id: 'p', name: 'Projeto QA' }], next_cursor: null };
    else if (path.endsWith('/tasks')) body = { results: [...remote.values()], next_cursor: null };
    else if (path.endsWith('/sync')) {
      const command = JSON.parse(new URLSearchParams(options.body).get('commands'))[0];
      commands.push(command); remote.delete(command.args.id); body = { sync_status: { [command.uuid]: 'ok' } };
    } else body = remote.get(path.split('/').at(-1));
    return { status: body ? 200 : 404, headers: {}, body: JSON.stringify(body || {}) };
  };
  state.side.onInit();
  assert.ok(state.side.bridge);
  const request = (message) => new Promise((resolve,reject) => state.side.onRequest(message, (error,result) => error ? reject(error) : resolve(result)));
  const { synchronizeDevice } = await import('../../shared/adapters/device-sync.js');
  await synchronizeDevice(state.app.globalData.store, request);
  const [tasks, detail, pending, history] = state.pages;
  tasks.onInit(); tasks.build();
  assert.ok(findButton('Próximas'));
  findButton('Próximas').props.click_func();
  assert.ok(findButton('Tarefa futura sintética'));
  findButton('Tarefa futura sintética').props.click_func();
  assert.deepEqual(state.routes.at(-1), { url: 'page/detail/index', params: { id: '2' } });
  detail.onInit({ id: '2' }); detail.build();
  assert.ok(state.widgets.some((item) => item.props.text.includes('Projeto QA')));
  findButton('Concluir').props.click_func();
  assert.equal(state.app.globalData.store.pendingOperations().length, 1);
  assert.equal(state.app.globalData.store.history()[0].localDate, '2026-10-20');
  pending.onInit(); pending.build(); assert.ok(state.widgets.some((item) => item.props.text === 'A enviar'));
  history.onInit(); history.build(); assert.ok(state.widgets.some((item) => item.props.text.includes('Dia local: 2026-10-20')));
  await synchronizeDevice(state.app.globalData.store, request);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].args.date_completed, '2026-10-21T02:15:30.500Z');
  assert.equal(state.app.globalData.store.pendingOperations().length, 0);
  assert.equal(state.app.globalData.store.history()[0].state, 'confirmed');
  assert.doesNotMatch(JSON.stringify([...state.files]), /SIMULATED_REPLACEMENT/);
});

test('QA Zepp host mock: Settings conflict resolution is explicit, preserves history and never writes recurring command', async () => {
  state.files.clear(); state.settings.clear(); state.settings.set('pulso.token', 'SIMULATED_PHONE_ONLY'); state.app.onCreate();
  const task = { id: '3', content: 'Recorrência sintética', project_id: 'p', parent_id: null, priority: 1, updated_at: 'r1',
    due: { date: '2026-10-20', string: 'todos os dias', is_recurring: true } };
  let remoteCommands = 0;
  state.side.fetch = async (options) => {
    const path = new URL(options.url).pathname;
    if (path.endsWith('/sync')) { remoteCommands++; throw Error('RECURRING_COMMAND_MUST_NOT_BE_SENT'); }
    const body = path.endsWith('/user') ? { sub: 'a' } : path.endsWith('/projects') ? { results: [], next_cursor: null }
      : path.endsWith('/tasks') ? { results: [task], next_cursor: null } : task;
    return { status: 200, headers: {}, body };
  };
  state.side.onInit();
  const request = (message) => new Promise((resolve,reject) => state.side.onRequest(message, (error,result) => error ? reject(error) : resolve(result)));
  const { synchronizeDevice } = await import('../../shared/adapters/device-sync.js');
  const store = state.app.globalData.store;
  await synchronizeDevice(store, request);
  const event = store.completeTask('3', watchContext());
  await synchronizeDevice(store, request);
  assert.equal(store.getTask('3').due.date, '2026-10-21');
  const storage = { getItem: (key) => state.settings.get(key) ?? null, setItem: (key,value) => state.settings.set(key,value), removeItem: (key) => state.settings.delete(key) };
  let page = state.settingsPage.build({ settingsStorage: storage });
  assert.equal(page.children.filter((node) => node.component === 'Button' && node.props.label === 'Revisar e resolver').length, 1);
  assert.equal(state.settings.has('pulso.resolve'), false);
  page.children.find((node) => node.component === 'Button' && node.props.label === 'Revisar e resolver').props.onClick();
  assert.equal(state.settings.has('pulso.resolve'), false);
  page = state.settingsPage.build({ settingsStorage: storage });
  page.children.find((node) => node.component === 'Button' && node.props.label === 'Confirmar resolução local').props.onClick();
  state.side.onSettingsChange({ key: 'pulso.resolve', newValue: state.settings.get('pulso.resolve') });
  await synchronizeDevice(store, request);
  assert.equal(store.pendingOperations().length, 0);
  assert.equal(store.history()[0].id, event.id);
  assert.equal(store.history()[0].state, 'resolved');
  assert.equal(store.getTask('3').due.date, '2026-10-20');
  assert.equal(remoteCommands, 0);
});

test('QA Zepp host mock: corrupt queue opens raw cached tasks read only without deleting local data', () => {
  const preserved = new Map(state.files);
  state.files.set('queue-a.json', 'CORRUPTED_A'); state.files.set('queue-b.json', 'CORRUPTED_B');
  state.app.onCreate();
  const readonly = state.app.globalData.store;
  assert.equal(readonly.metadata().readOnly, true);
  assert.equal(readonly.getTask('3').id, '3');
  assert.throws(() => readonly.completeTask('3', watchContext()), { code: 'READ_ONLY_CACHE' });
  assert.equal(state.files.get('queue-a.json'), 'CORRUPTED_A');
  assert.equal(state.files.get('queue-b.json'), 'CORRUPTED_B');
  for (const [name, raw] of preserved) if (!name.startsWith('queue-')) assert.equal(state.files.get(name), raw);
});

test.after(() => {
  hooks.deregister();
  for (const name of ['App', 'getApp', 'Page', 'AppSideService', 'AppSettingsPage', 'View', 'Text', 'TextInput', 'Button']) delete globalThis[name];
});
