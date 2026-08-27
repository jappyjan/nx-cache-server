import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const initialState = () => ({ admins: [], tokens: [], audit: [], entries: {} });

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');

export async function createStateStore(directory) {
  const file = join(directory, 'admin-state.json');
  await mkdir(directory, { recursive: true });

  async function load() {
    try {
      const state = JSON.parse(await readFile(file, 'utf8'));
      return { ...initialState(), ...state, entries: state.entries ?? {} };
    } catch (error) {
      if (error.code === 'ENOENT') return initialState();
      throw error;
    }
  }

  let queue = Promise.resolve();
  async function update(mutator) {
    const operation = queue.then(async () => {
      const state = await load();
      const result = await mutator(state);
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, file);
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  return { load, update };
}
