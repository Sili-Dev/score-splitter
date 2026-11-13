import { createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import busboy from 'busboy';
import { nanoid } from 'nanoid';
import { UploadTooLargeError } from '@/lib/zip/unpack';

export type ReceivedFile = { originalName: string; storedPath: string; kind: 'zip' | 'pdf' | 'other' };

/** The request is not an upload we can use; the message is shown to the owner. */
export class BadUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadUploadError';
  }
}

async function sniff(path: string): Promise<'zip' | 'pdf' | 'other'> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(5);
    await handle.read(head, 0, 5, 0);
    if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
    if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
    return 'other';
  } finally {
    await handle.close();
  }
}

/**
 * Streams the files of a multipart upload to `destDir` under generated names
 * and reports what each one is, judged by its first bytes rather than its
 * name. Nothing is held in memory, and the upload is cut off as soon as it
 * passes `maxBytes`.
 */
export async function receiveUpload(request: Request, destDir: string, maxBytes: number): Promise<ReceivedFile[]> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!request.body || !contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new BadUploadError('Upload a zip file, or one or more PDFs.');
  }
  await mkdir(destDir, { recursive: true });

  const files: ReceivedFile[] = [];
  const writes: Promise<void>[] = [];
  let total = 0;

  let parser: busboy.Busboy;
  try {
    parser = busboy({ headers: { 'content-type': contentType }, defParamCharset: 'utf8', preservePath: false });
  } catch {
    throw new BadUploadError('Upload a zip file, or one or more PDFs.');
  }

  parser.on('file', (_field, stream, info) => {
    const storedPath = join(destDir, `${nanoid(16)}.upload`);
    const meter = new Transform({
      transform(chunk: Buffer, _enc, next) {
        total += chunk.length;
        next(total > maxBytes ? new UploadTooLargeError() : null, chunk);
      },
    });
    const write = pipeline(stream, meter, createWriteStream(storedPath)).then(async () => {
      files.push({ originalName: info.filename || 'upload', storedPath, kind: await sniff(storedPath) });
    });
    // Stop reading the request as soon as one file fails; the caller cleans up the folder.
    write.catch((cause) => parser.destroy(cause as Error));
    writes.push(write);
  });

  const body = Readable.fromWeb(request.body as unknown as NodeWebStream<Uint8Array>);
  try {
    await pipeline(body, parser);
    await Promise.all(writes);
  } catch (cause) {
    await Promise.allSettled(writes);
    if (cause instanceof UploadTooLargeError) throw cause;
    throw new BadUploadError('The upload was interrupted or is not a valid form upload.');
  }
  return files;
}
