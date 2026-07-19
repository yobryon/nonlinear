import { describe, expect, it } from 'vitest';
import { createAzureBlobStore } from './blob-azure.js';

/**
 * Integration test — runs only when AZURE_BLOB_TEST_CONNECTION_STRING points at
 * a disposable Azure Storage account or an Azurite emulator. Skipped otherwise.
 *
 *   AZURE_BLOB_TEST_CONNECTION_STRING="UseDevelopmentStorage=true" pnpm --filter @nonlinear/api test blob-azure
 */
const conn = process.env.AZURE_BLOB_TEST_CONNECTION_STRING;

describe.skipIf(!conn)('azure blob store', () => {
  it('round-trips put / get / delete with content type', async () => {
    const store = await createAzureBlobStore(conn!, 'attachments-test');
    const key = `it/${Date.now()}-hello.txt`;
    const payload = Buffer.from('hello azurite');

    await store.put(key, payload, 'text/plain');
    const got = await store.get(key);
    expect(got).not.toBeNull();
    expect(got!.data.equals(payload)).toBe(true);
    expect(got!.contentType).toBe('text/plain');

    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });

  it('returns null for a missing blob', async () => {
    const store = await createAzureBlobStore(conn!, 'attachments-test');
    expect(await store.get('it/does-not-exist')).toBeNull();
  });
});
