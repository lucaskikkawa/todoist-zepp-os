// Integrity checks detect torn writes and accidental corruption; not cryptography.
export function checksum(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}

export function encode(value) {
  const payload = JSON.stringify(value);
  return JSON.stringify({ checksum: checksum(payload), payload });
}

export function decode(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const envelope = JSON.parse(raw);
    if (typeof envelope.payload !== 'string' || checksum(envelope.payload) !== envelope.checksum) return null;
    return JSON.parse(envelope.payload);
  } catch { return null; }
}

export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function fail(code) { const error = new Error(code); error.code = code; throw error; }
export function checkedWrite(fs, name, value) {
  const raw = encode(value);
  fs.write(name, raw);
  if (fs.read(name) !== raw) fail('STORAGE_WRITE_FAILED');
}
