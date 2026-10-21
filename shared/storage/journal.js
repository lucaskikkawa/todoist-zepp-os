import { checkedWrite, clone, decode, fail } from './integrity.js';

function valid(value) {
  return value && value.version === 1 && Number.isSafeInteger(value.sequence) && value.sequence >= 0 &&
    Array.isArray(value.completions) && Array.isArray(value.operations) &&
    value.operations.every((op) => typeof op.uuid === 'string' && typeof op.state === 'string') &&
    value.completions.every((event) => typeof event.id === 'string' && typeof event.taskId === 'string');
}

// Both copies contain the last acknowledged event. A failed mirror write throws,
// but its first verified copy is recovered on restart and deduplicated on retry.
export class Journal {
  constructor(fs) { this.fs = fs; this.state = this.load(); }
  load() {
    const raw = [this.fs.read('queue-a.json'), this.fs.read('queue-b.json')];
    const candidates = raw.map(decode).filter(valid).sort((a, b) => b.sequence - a.sequence);
    if (!candidates.length) {
      if (raw.some((value) => value !== null && value !== undefined)) fail('QUEUE_CORRUPT');
      return { version: 1, sequence: 0, accountId: null, completions: [], operations: [] };
    }
    return candidates[0];
  }
  commit(update) {
    this.state = this.load();
    const next = clone(this.state);
    update(next);
    next.sequence += 1;
    const first = next.sequence % 2 ? 'queue-a.json' : 'queue-b.json';
    const second = next.sequence % 2 ? 'queue-b.json' : 'queue-a.json';
    try {
      checkedWrite(this.fs, first, next);
      checkedWrite(this.fs, second, next);
      this.state = next;
    } catch (error) {
      this.state = this.load();
      throw error;
    }
    return clone(next);
  }
}
