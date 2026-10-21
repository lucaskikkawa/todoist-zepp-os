import { readFileSync, writeFileSync, rmSync, statSync } from '@zos/fs';

// Relative names resolve inside the application's isolated /data directory.
export const zeppFs = {
  read(path) {
    const value = readFileSync({ path, options: { encoding: 'utf8' } });
    if (typeof value === 'string') return value;
    if (statSync({ path })) { const error = new Error('STORAGE_READ_FAILED'); error.code = 'STORAGE_READ_FAILED'; throw error; }
    return null;
  },
  write(path, data) { writeFileSync({ path, data, options: { encoding: 'utf8' } }); },
  remove(path) { rmSync({ path }); }
};
