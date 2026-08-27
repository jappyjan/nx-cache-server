import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function createCache(directory, state) {
  const path = (hash) => join(directory, hash);
  const removeFile = (hash) => unlink(path(hash)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });

  return {
    read(hash) { return createReadStream(path(hash)); },
    async write(hash, request) {
      const target = path(hash);
      await stat(target).then(() => { throw new Error('exists'); }).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await new Promise((resolve, reject) => {
        const output = createWriteStream(temporary);
        request.pipe(output).on('error', reject).on('finish', resolve);
        output.on('error', reject);
      });
      await rename(temporary, target);
      const details = await stat(target);
      await state.update((data) => { data.entries[hash] = { hash, size: details.size, createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), accessCount: 0 }; });
    },
    async touch(hash) { await state.update((data) => { if (data.entries[hash]) { data.entries[hash].lastAccessedAt = new Date().toISOString(); data.entries[hash].accessCount = (data.entries[hash].accessCount ?? 0) + 1; } }); },
    async summary() {
      const entries = Object.values((await state.load()).entries);
      return { entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0), pruneAfterDays: Number(process.env.PRUNE_AFTER_DAYS ?? 14) };
    },
    async list(requestedPage = 1, limit = 15) {
      const entries = Object.values((await state.load()).entries).sort((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt));
      const totalPages = Math.max(1, Math.ceil(entries.length / limit));
      const page = Math.min(Math.max(1, Number(requestedPage) || 1), totalPages);
      return { items: entries.slice((page - 1) * limit, page * limit), page, pageSize: limit, total: entries.length, totalPages };
    },
    async delete(hash) {
      if (!/^[\w-]+$/.test(hash)) throw new Error('invalid hash');
      await removeFile(hash);
      await state.update((data) => { delete data.entries[hash]; });
    },
    async clear() {
      const stored = Object.keys((await state.load()).entries);
      const files = (await readdir(directory).catch(() => [])).filter((name) => /^[\w-]+$/.test(name));
      const hashes = [...new Set([...stored, ...files])];
      await Promise.all(hashes.map(removeFile));
      await state.update((data) => { for (const hash of hashes) delete data.entries[hash]; });
      return hashes.length;
    },
    async prune(cutoff) {
      for (const name of await readdir(directory).catch(() => [])) {
        if (!/^[\w-]+$/.test(name)) continue;
        const details = await stat(path(name)).catch(() => null);
        if (details?.isFile() && details.atimeMs < cutoff) await this.delete(name).catch(() => {});
      }
    }
  };
}
