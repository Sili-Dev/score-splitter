import { createWriteStream } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import iconv from 'iconv-lite';
import { nanoid } from 'nanoid';
import yauzl from 'yauzl';
import { pieceNameFromFileName } from '@/lib/classify';

export class UploadTooLargeError extends Error {
  constructor() {
    super('The upload is larger than this server accepts.');
    this.name = 'UploadTooLargeError';
  }
}

export type UnpackedFile = { originalName: string; storedPath: string };
export type UnpackedPiece = { name: string; files: UnpackedFile[] };
export type Unpacked = { pieces: UnpackedPiece[]; ignored: string[]; rootName: string };

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Zip entry names are UTF-8 when flagged. Unflagged names are CP437 by the
 * standard, but many tools write UTF-8 without setting the flag, so valid
 * UTF-8 is taken as such.
 */
export function decodeEntryName(raw: Buffer, utf8Flag: boolean): string {
  if (!utf8Flag) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      return iconv.decode(raw, 'cp437');
    }
  }
  return raw.toString('utf8');
}

/** True if the entry would be written outside the folder it is unpacked into. */
function escapes(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..');
}

function hidden(path: string): boolean {
  return path.split('/').some((segment) => segment === '__MACOSX' || segment.startsWith('.'));
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((ok, fail) => {
    // decodeStrings: false hands us raw name bytes and turns off yauzl's own
    // path checks, so `escapes` above is the only guard.
    yauzl.open(path, { lazyEntries: true, decodeStrings: false, autoClose: true }, (err, zip) =>
      err || !zip ? fail(err ?? new Error('Could not open zip')) : ok(zip),
    );
  });
}

function stripExtension(name: string): string {
  return basename(name).replace(/\.[^.]+$/, '');
}

/**
 * Unpacks the PDFs of an uploaded zip into `destDir` and groups them into
 * pieces, one per folder that directly holds PDFs. Files are stored under
 * generated names; names from the zip are only ever used as labels.
 */
export async function unpackZip(
  zipPath: string,
  destDir: string,
  maxBytes: number,
  uploadName: string,
): Promise<Unpacked> {
  const zip = await openZip(zipPath);
  const dest = resolve(destDir);
  const folders = new Map<string, UnpackedFile[]>();
  const ignored: string[] = [];
  const topLevel = new Set<string>();
  let total = 0;

  try {
    await new Promise<void>((done, fail) => {
      zip.on('error', fail);
      zip.on('end', done);
      zip.on('entry', (entry: yauzl.Entry) => {
        const raw = entry.fileName as unknown as Buffer;
        const path = decodeEntryName(raw, (entry.generalPurposeBitFlag & 0x800) !== 0).replace(/\\/g, '/');

        if (path.endsWith('/')) return zip.readEntry();
        if (escapes(path)) {
          ignored.push(path);
          return zip.readEntry();
        }
        if (hidden(path)) return zip.readEntry();
        if (!/\.pdf$/i.test(path)) {
          ignored.push(path);
          return zip.readEntry();
        }
        if (total + entry.uncompressedSize > maxBytes) return fail(new UploadTooLargeError());

        const storedPath = join(dest, `${nanoid(16)}.pdf`);
        if (!resolve(storedPath).startsWith(dest + sep)) return fail(new Error('Unsafe path'));

        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err ?? new Error('Could not read zip entry'));
          // The declared size can lie; count what actually comes out.
          const meter = new Transform({
            transform(chunk: Buffer, _enc, next) {
              total += chunk.length;
              next(total > maxBytes ? new UploadTooLargeError() : null, chunk);
            },
          });
          pipeline(stream, meter, createWriteStream(storedPath)).then(() => {
            const cut = path.lastIndexOf('/');
            const folder = cut === -1 ? '' : path.slice(0, cut);
            const files = folders.get(folder) ?? [];
            files.push({ originalName: path.slice(cut + 1), storedPath });
            folders.set(folder, files);
            topLevel.add(cut === -1 ? '' : path.split('/')[0]);
            zip.readEntry();
          }, fail);
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }

  const uploadStem = stripExtension(uploadName);
  const pieces = [...folders.entries()]
    .sort(([a], [b]) => byName.compare(a, b))
    .map(([folder, files]) => ({
      name: folder === '' ? uploadStem : folder.slice(folder.lastIndexOf('/') + 1),
      files: files.sort((a, b) => byName.compare(a.originalName, b.originalName)),
    }));

  const [only] = topLevel;
  const rootName = topLevel.size === 1 && only !== '' && pieces.some((p) => p.name !== only) ? only : uploadStem;
  return { pieces, ignored, rootName };
}

/** PDFs uploaded without a zip form one piece, named after the first file. */
export function piecesFromLoosePdfs(files: UnpackedFile[]): UnpackedPiece[] {
  if (files.length === 0) return [];
  const sorted = [...files].sort((a, b) => byName.compare(a.originalName, b.originalName));
  return [{ name: pieceNameFromFileName(sorted[0].originalName), files: sorted }];
}
