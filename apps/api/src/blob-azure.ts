import { BlobServiceClient, RestError } from '@azure/storage-blob';
import type { BlobStore } from '@nonlinear/core';

/**
 * Azure Blob Storage implementation of the `BlobStore` seam — the portable
 * attachment backend for an Azure deploy, selected at boot when
 * AZURE_BLOB_CONNECTION_STRING is set (see index.ts). The Azure SDK is
 * confined to this adapter so `packages/core` stays free of infra drivers,
 * mirroring how the Postgres driver lives only in `storage-postgres`.
 *
 * Content type is stored natively on the blob (no sidecar file, unlike the fs
 * store). Keys are sanitized to a safe blob-name charset. Works against a real
 * Azure Storage account or the Azurite emulator via the same connection string.
 */
export async function createAzureBlobStore(
  connectionString: string,
  containerName: string,
): Promise<BlobStore> {
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists();

  const blobFor = (key: string) => container.getBlockBlobClient(safeKey(key));

  return {
    async put(key, data, contentType) {
      await blobFor(key).uploadData(data, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    },
    async get(key) {
      try {
        const res = await blobFor(key).download();
        const data = await streamToBuffer(res.readableStreamBody);
        return { data, contentType: res.contentType ?? 'application/octet-stream' };
      } catch (err) {
        if (err instanceof RestError && err.statusCode === 404) return null;
        throw err;
      }
    },
    async delete(key) {
      await blobFor(key).deleteIfExists();
    },
  };
}

/** Blob names allow a wide charset, but keep keys predictable and path-safe. */
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._/-]/g, '_');
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
