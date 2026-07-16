import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Binary storage boundary for attachment payloads. Swappable like Storage:
 * memory (tests), filesystem (self-host volume), and later Azure Blob as a
 * sibling implementation.
 */
export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, { data: Buffer; contentType: string }>();
  return {
    async put(key, data, contentType) {
      blobs.set(key, { data, contentType });
    },
    async get(key) {
      return blobs.get(key) ?? null;
    },
    async delete(key) {
      blobs.delete(key);
    },
  };
}

/** Stores blobs as files under `dir`; content type in a sidecar file. */
export function createFsBlobStore(dir: string): BlobStore {
  const fileFor = (key: string) => {
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(dir, safe);
  };
  return {
    async put(key, data, contentType) {
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(key), data);
      await writeFile(`${fileFor(key)}.meta`, contentType, 'utf8');
    },
    async get(key) {
      try {
        const [data, contentType] = await Promise.all([
          readFile(fileFor(key)),
          readFile(`${fileFor(key)}.meta`, 'utf8').catch(() => 'application/octet-stream'),
        ]);
        return { data, contentType };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
      await rm(`${fileFor(key)}.meta`, { force: true });
    },
  };
}
