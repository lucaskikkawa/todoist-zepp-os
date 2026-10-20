export class MemoryFs {
  constructor() { this.files = new Map(); this.writes = 0; this.failAt = null; this.tearAt = null; }
  read(name) { return this.files.has(name) ? this.files.get(name) : null; }
  write(name, text) {
    this.writes += 1;
    if (this.writes === this.failAt) throw new Error('SIMULATED_DISK_FULL');
    this.files.set(name, this.writes === this.tearAt ? text.slice(0, text.length / 2) : text);
  }
  remove(name) { this.files.delete(name); }
}

export function fixtureTask(id, overrides = {}) {
  return { id: String(id), title: `Tarefa ${id}`, projectId: 'project-1', parentId: null, priority: 1, due: null, revision: 'revision-1', ...overrides };
}
