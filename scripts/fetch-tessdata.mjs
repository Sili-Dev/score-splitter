// Downloads the Tesseract language data used for OCR into ./tessdata.
// Runs after `npm install`; the files are bundled into the Docker image so
// that the app never needs the network at runtime.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LANGS = ['eng', 'deu'];
const BASE = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tessdata');

mkdirSync(dir, { recursive: true });

for (const lang of LANGS) {
  const target = join(dir, `${lang}.traineddata`);
  if (existsSync(target) && statSync(target).size > 100_000) continue;
  const res = await fetch(`${BASE}/${lang}.traineddata`);
  if (!res.ok || !res.body) {
    console.error(`fetch-tessdata: could not download ${lang}.traineddata (HTTP ${res.status})`);
    process.exit(1);
  }
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, target);
  console.log(`fetch-tessdata: ${lang}.traineddata`);
}
