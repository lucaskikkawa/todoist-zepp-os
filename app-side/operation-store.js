const copy = (value) => JSON.parse(JSON.stringify(value));

function checksum(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
}

function decode(raw) {
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw);
    if (checksum(envelope.body) !== envelope.checksum) return null;
    const data = JSON.parse(envelope.body);
    return data.version === 1 && Number.isSafeInteger(data.sequence) && Array.isArray(data.records) ? data : null;
  } catch { return null; }
}

/** Settings Storage adapter; all state changes verified before network or acknowledgement. */
export class OperationStore {
  constructor(storage, prefix = 'pulso.operations') {
    this.storage = storage;
    this.prefix = prefix;
    const raw = [0, 1].map((slot) => storage.getItem(`${prefix}.${slot}`));
    const valid = raw.map(decode).filter(Boolean).sort((a, b) => b.sequence - a.sequence);
    if (!valid.length && raw.some(Boolean)) throw new Error('SIDE_STORE_CORRUPT');
    this.data = valid[0] || { version: 1, sequence: 0, records: [] };
  }

  get(accountId, uuid) {
    const record = this.data.records.find((entry) => entry.accountId === accountId && entry.uuid === uuid);
    return record ? copy(record) : null;
  }

  put(record) {
    const next = copy(this.data);
    const index = next.records.findIndex((entry) => entry.accountId === record.accountId && entry.uuid === record.uuid);
    if (index < 0) next.records.push(copy(record));
    else next.records[index] = copy(record);
    next.sequence++;
    const body = JSON.stringify(next);
    const raw = JSON.stringify({ body, checksum: checksum(body) });
    for (const slot of [next.sequence % 2, 1 - (next.sequence % 2)]) {
      const key = `${this.prefix}.${slot}`;
      this.storage.setItem(key, raw);
      const persisted = decode(this.storage.getItem(key));
      if (!persisted || persisted.sequence !== next.sequence || JSON.stringify(persisted) !== body) {
        throw new Error('SIDE_STORE_WRITE');
      }
      // If mirroring the second slot fails, retain the first verified record in
      // memory as well. No later write may roll back a confirmed/sent state.
      this.data = next;
    }
    return copy(record);
  }

  list() { return copy(this.data.records); }
}
