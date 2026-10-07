import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function openStore(directory, seed) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'hub.json');
  let current;
  try { current = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    current = structuredClone(seed);
    await writeFile(filename, JSON.stringify(current, null, 2));
  }
  if (current.schemaVersion !== 1) throw new Error('Unsupported Hub database version');
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(current),
    change: (operation) => {
      const work = queue.then(async () => {
        const next = structuredClone(current);
        const result = await operation(next);
        next.revision += 1;
        next.updatedAt = new Date().toISOString();
        await writeFile(`${filename}.tmp`, JSON.stringify(next, null, 2));
        await rename(`${filename}.tmp`, filename);
        current = next;
        return result;
      });
      queue = work.catch(() => {});
      return work;
    },
  };
}
