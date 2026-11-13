# Score Splitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted web app that takes a zip or PDFs of brass band music, splits each combined parts scan into one PDF per part using OCR, lets the owner correct the splits, and exports a tidy zip.

**Architecture:** One Next.js process. An upload creates a job on disk; a background pipeline unpacks it, classifies each PDF, and for combined scans renders the header of each page, OCRs it, and groups pages into parts. The job state is a single JSON file that the review UI reads and edits through a small API; export copies pages losslessly into new PDFs and streams a zip.

**Tech Stack:** Next.js (App Router) + TypeScript, Tailwind CSS + shadcn/ui, `pdfjs-dist` + `@napi-rs/canvas` (render), `tesseract.js` (OCR, `eng`+`deu`), `pdf-lib` (split), `yauzl` + `archiver` (zip), `iconv-lite` (zip names), Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-11-13-score-splitter-design.md`

## Global Constraints

- Every page of an input PDF ends up in exactly one output file or is explicitly discarded. Page order never changes.
- Pages are copied with `pdf-lib` `copyPages`; never re-rendered or re-encoded.
- No outbound network calls at runtime. Tesseract language data is bundled.
- No copyrighted sheet music in the repository. `samples/` is git-ignored; tests use generated pages only.
- Export file name pattern: `<Piece> - <Part>.pdf`; scores: `<Piece> - Partitur.pdf`.
- Unidentified parts are named `Unbekannt <n>`; export is blocked while any remain.
- Environment variables and defaults: `DATA_DIR=./data`, `MAX_UPLOAD_MB=500`, `JOB_TTL_HOURS=24`, `OCR_CONCURRENCY=2`, `PORT=3000`.
- Interface text in English, all strings in `src/lib/i18n/en.ts`.
- Licence MIT. Container runs as non-root, images for `linux/amd64` and `linux/arm64`.
- All paths below are relative to `C:\workspace\score-splitter`.

## Review Focus

1. **Zip entry names that escape the job directory** (`../../x.pdf`, absolute paths): the entry is skipped and listed as ignored; nothing is written outside the job directory. → Task 6.
2. **Corrupt, encrypted, or zero-page PDF in an otherwise good zip:** that file is marked `error` with a readable message; the rest of the job completes and exports. → Task 8.
3. **Piece or part names with characters illegal in file names** (`/ \ : * ? " < > |`, trailing dots, e.g. a part renamed to "Horn 1/2"): replaced with `-` in the export path; the zip opens on Windows. → Task 7.
4. **Server restart while a job is processing:** on start, jobs left in `processing` resume from the first unfinished file rather than hanging forever. → Task 8.
5. **Upload larger than `MAX_UPLOAD_MB`, or a zip that expands far beyond it:** rejected with HTTP 413 and a clear message; unpacking stops once extracted bytes exceed 4× the limit. → Tasks 6 and 9.

---

## File Structure

```
src/lib/types.ts              shared types (below)
src/lib/config.ts             env parsing
src/lib/i18n/en.ts            UI strings
src/lib/parts/catalog.ts      standard part names + variants (data only)
src/lib/parts/match.ts        text → standard part name
src/lib/detect/header.ts      OCR lines of one page → PageDetection
src/lib/detect/group.ts       PageDetection[] → Part[]
src/lib/pdf/render.ts         PDF page → PNG (header strip, thumbnail)
src/lib/ocr/tesseract.ts      PNG → OcrLine[]
src/lib/pdf/split.ts          copy page ranges into a new PDF
src/lib/zip/unpack.ts         upload → pieces on disk
src/lib/classify.ts           file → score | single | combined
src/lib/jobs/store.ts         job JSON read/write/delete
src/lib/jobs/edit.ts          pure edit operations on a Job
src/lib/jobs/process.ts       background pipeline
src/lib/jobs/cleanup.ts       TTL sweep
src/lib/export.ts             Job → zip stream
src/app/…                     pages and API routes
tests/helpers/makeScan.ts     generates image-only test PDFs
scripts/probe.ts              runs detection on a local zip, prints a table
```

Shared types, defined in Task 1 and used everywhere:

```ts
export type Confidence = 'high' | 'low';
export type PartMatch = { name: string; exact: boolean };
/** Coordinates are fractions 0..1 of the rendered strip. */
export type OcrLine = { text: string; x0: number; x1: number; y0: number; y1: number };
export type PageDetection = { partName: string | null; confidence: Confidence; rawText: string };
export type FileClass = 'score' | 'single' | 'combined';
export type PartFlag = 'fuzzy' | 'long' | 'duplicate' | 'unknown';
export type Part = { id: string; name: string; pages: number[]; confidence: Confidence; flags: PartFlag[] };
export type SourceFile = {
  id: string; originalName: string; storedPath: string; pageCount: number;
  class: FileClass; parts: Part[]; discarded: number[];
  status: 'pending' | 'processing' | 'done' | 'error'; error?: string;
};
export type Piece = { id: string; name: string; files: SourceFile[] };
export type Job = {
  id: string; name: string; createdAt: string;
  status: 'processing' | 'ready'; pieces: Piece[]; ignored: string[];
};
```

Page numbers are zero-based indexes into the source PDF throughout.

---

### Task 1: Project scaffold

**Files:**
- Create: project via `create-next-app`, `vitest.config.ts`, `src/lib/types.ts`, `src/lib/config.ts`, `LICENSE`, `.gitignore`, `tests/config.test.ts`

**Interfaces:**
- Produces: the types above; `getConfig(): { dataDir: string; maxUploadBytes: number; jobTtlMs: number; ocrConcurrency: number }`

- [ ] **Step 1:** `git init` in the project root, then `npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --use-npm --no-turbopack --import-alias "@/*"` (the existing `docs/` folder stays).
- [ ] **Step 2:** `npm i pdfjs-dist @napi-rs/canvas tesseract.js pdf-lib yauzl archiver iconv-lite nanoid` and `npm i -D vitest @types/yauzl @types/archiver tsx @playwright/test`. Add scripts `"test": "vitest run"`, `"probe": "tsx scripts/probe.ts"`.
- [ ] **Step 3:** `npx shadcn@latest init -d`, then add `button card input badge dialog progress sonner tooltip`.
- [ ] **Step 4:** Add `samples/`, `data/`, `*.traineddata` download cache to `.gitignore`; add MIT `LICENSE`; set `output: 'standalone'` and `serverExternalPackages: ['@napi-rs/canvas', 'tesseract.js', 'pdfjs-dist']` in `next.config.ts`.
- [ ] **Step 5:** Write `tests/config.test.ts`:

```ts
it('uses defaults', () => {
  expect(getConfig({})).toEqual({ dataDir: './data', maxUploadBytes: 500 * 1024 * 1024, jobTtlMs: 24 * 3600_000, ocrConcurrency: 2 });
});
it('reads overrides', () => {
  expect(getConfig({ MAX_UPLOAD_MB: '10', JOB_TTL_HOURS: '1', OCR_CONCURRENCY: '4', DATA_DIR: '/data' }).maxUploadBytes).toBe(10 * 1024 * 1024);
});
```

- [ ] **Step 6:** Create `src/lib/types.ts` (types above) and `getConfig(env = process.env)` in `src/lib/config.ts`. Run `npm test` → PASS. Run `npm run build` → succeeds.
- [ ] **Step 7:** Commit: `chore: scaffold Next.js app with test tooling`.

---

### Task 2: Part name matching

**Files:**
- Create: `src/lib/parts/catalog.ts`, `src/lib/parts/match.ts`
- Test: `tests/parts/match.test.ts`

**Interfaces:**
- Produces: `STANDARD_PARTS: string[]`; `matchPartName(text: string): PartMatch | null`; `instrumentFamilies(text: string): string[]` (distinct instrument families named in a line, e.g. `['flugelhorn','horn','baritone']`)

- [ ] **Step 1: Write the failing tests**

```ts
const cases: [string, string][] = [
  ['Eb Soprano Cornet', 'Soprano Cornet'],
  ['E> Soprano Cornet', 'Soprano Cornet'],      // OCR of the flat sign
  ['Soprano Eb Cornet', 'Soprano Cornet'],
  ['Solo Bb Cornet', 'Solo Cornet'],
  ['Repiano Bb Cornet', 'Repiano Cornet'],
  ['2nd Bb Cornet', '2nd Cornet'],
  ['3rd Bb Cornet', '3rd Cornet'],
  ['Bb Flugelhorn', 'Flugelhorn'],
  ['Flugel Horn', 'Flugelhorn'],
  ['Solo Eb Horn', 'Solo Horn'],
  ['1st Eb Horn', '1st Horn'],
  ['1. Es-Horn', '1st Horn'],
  ['2nd Bb Baritone', '2nd Baritone'],
  ['1st Bb Trombone', '1st Trombone'],
  ['2. Posaune', '2nd Trombone'],
  ['Bass C Trombone', 'Bass Trombone'],
  ['Bass Trombone', 'Bass Trombone'],
  ['1st Bb Euphonium', '1st Euphonium'],
  ['Euphonium', 'Euphonium'],
  ['Eb Bass', 'Eb Bass'],
  ['Es-Bass', 'Eb Bass'],
  ['Bb Bass', 'Bb Bass'],
  ['Timpani', 'Timpani'],
  ['Pauken', 'Timpani'],
  ['Glockenspiel', 'Glockenspiel'],
  ['Sus. Cymbal', 'Suspended Cymbal'],
  ['Schlagzeug', 'Percussion'],
  ['Percussion 1', 'Percussion 1'],
  ['2nd & 3rd Cornet', '2nd + 3rd Cornet'],
  ['Solo Comet', 'Solo Cornet'],                 // classic OCR slip
  ['lst Baritone', '1st Baritone'],              // l for 1
];
it.each(cases)('%s → %s', (input, expected) => expect(matchPartName(input)?.name).toBe(expected));

it('marks clean input exact and slips fuzzy', () => {
  expect(matchPartName('Solo Cornet')?.exact).toBe(true);
  expect(matchPartName('Solo Comet')?.exact).toBe(false);
});
it.each(['ALLADALE', 'Philip Sparke', 'from Hymn of the Highlands', '', 'cup mute'])('rejects %s', (t) =>
  expect(matchPartName(t)).toBeNull());
it('counts families', () => {
  expect(instrumentFamilies('Flugel Horn, Horn & Baritone Trio')).toEqual(['flugelhorn', 'horn', 'baritone']);
  expect(instrumentFamilies('2nd & 3rd Cornet')).toEqual(['cornet']);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/parts` → FAIL (module missing).
- [ ] **Step 3:** Implement. `catalog.ts` exports data only: families with their aliases (English, German, OCR slips), rank aliases (`solo`, `repiano|ripiano`, `soprano`, `1st|1.|lst|first|1`, `2nd|2.`, `3rd|3.`, `bass`), and key tokens to drop (`bb`, `eb`, `es`, `b`, `c`, and any 1–2 character token adjacent to an instrument word). `match.ts` normalises (lowercase, strip punctuation except `&`/`+`, collapse spaces), tokenises, finds the instrument family (exact alias, else Levenshtein distance ≤ 1 for tokens of length ≥ 5 → `exact: false`), attaches rank, and formats as `<Rank> <Instrument>`. Bass keeps its key (`Eb Bass`, `Bb Bass`) because the key is the name. Trailing digits on percussion are kept.
- [ ] **Step 4:** Run `npx vitest run tests/parts` → PASS.
- [ ] **Step 5:** Commit: `feat: match OCR text to standard part names`.

---

### Task 3: Choosing the part name from a page header

**Files:**
- Create: `src/lib/detect/header.ts`
- Test: `tests/detect/header.test.ts`

**Interfaces:**
- Consumes: `matchPartName`, `instrumentFamilies`, `OcrLine`
- Produces: `detectPart(lines: OcrLine[]): PageDetection`

- [ ] **Step 1: Write the failing tests.** The first is the real Alladale header.

```ts
const L = (text: string, x0: number, x1: number, y0 = 0.5): OcrLine => ({ text, x0, x1, y0, y1: y0 + 0.1 });

it('picks the left-margin part name over a subtitle naming instruments', () => {
  const d = detectPart([
    L('Commissioned by the Yorkshire Building Society Band', 0.3, 0.7, 0.05),
    L('ALLADALE', 0.38, 0.62, 0.25),
    L('from Hymn of the Highlands', 0.35, 0.65, 0.45),
    L('Eb Soprano Cornet', 0.04, 0.25, 0.6),
    L('Flugel Horn, Horn & Baritone Trio', 0.3, 0.7, 0.7),
    L('Philip Sparke', 0.84, 0.98, 0.6),
  ]);
  expect(d).toMatchObject({ partName: 'Soprano Cornet', confidence: 'high' });
});
it('returns null when only a multi-instrument subtitle matches', () =>
  expect(detectPart([L('Flugel Horn, Horn & Baritone Trio', 0.3, 0.7)]).partName).toBeNull());
it('accepts a centred part name when it is the only candidate', () =>
  expect(detectPart([L('Solo Cornet', 0.4, 0.6)])).toMatchObject({ partName: 'Solo Cornet', confidence: 'low' }));
it('prefers left over right over centre', () =>
  expect(detectPart([L('1st Horn', 0.45, 0.55), L('2nd Horn', 0.8, 0.97), L('Solo Horn', 0.03, 0.2)]).partName).toBe('Solo Horn'));
it('is low confidence on a fuzzy match', () =>
  expect(detectPart([L('Solo Comet', 0.03, 0.2)]).confidence).toBe('low'));
it('keeps a shared part', () =>
  expect(detectPart([L('2nd & 3rd Cornet', 0.03, 0.25)]).partName).toBe('2nd + 3rd Cornet'));
it('returns null and the raw text when nothing matches', () =>
  expect(detectPart([L('- 2 -', 0.45, 0.55)])).toEqual({ partName: null, confidence: 'high', rawText: '- 2 -' }));
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `detectPart`. Drop lines where `instrumentFamilies(text).length >= 2`. Match the rest. Zone of a line: `left` if `x0 < 0.15`, `right` if `x1 > 0.85`, else `centre`; rank left, right, centre; ties go to the lower line (larger `y0`). Confidence is `high` only if the match is exact and the zone is left or right. `rawText` is all line texts joined by `\n`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: choose part name from header lines by position`.

---

### Task 4: Grouping pages into parts

**Files:**
- Create: `src/lib/detect/group.ts`
- Test: `tests/detect/group.test.ts`

**Interfaces:**
- Consumes: `PageDetection`, `Part`
- Produces: `groupPages(detections: PageDetection[]): Part[]`; `reflag(parts: Part[]): Part[]` (recomputes `long`/`duplicate`/`unknown` flags; used again after edits)

- [ ] **Step 1: Write the failing tests**

```ts
const D = (partName: string | null, confidence: Confidence = 'high'): PageDetection => ({ partName, confidence, rawText: '' });
const shape = (ps: Part[]) => ps.map(p => [p.name, p.pages]);

it('starts a part on each match and continues on null', () =>
  expect(shape(groupPages([D('Solo Cornet'), D(null), D('Repiano Cornet')])))
    .toEqual([['Solo Cornet', [0, 1]], ['Repiano Cornet', [2]]]));
it('handles a four-page part', () =>
  expect(shape(groupPages([D('Solo Cornet'), D(null), D(null), D(null), D('2nd Cornet')]))[0])
    .toEqual(['Solo Cornet', [0, 1, 2, 3]]));
it('joins consecutive pages repeating the same name', () =>
  expect(shape(groupPages([D('Eb Bass'), D('Eb Bass'), D('Bb Bass')])))
    .toEqual([['Eb Bass', [0, 1]], ['Bb Bass', [2]]]));
it('puts leading unmatched pages in Unbekannt 1, flagged', () => {
  const ps = groupPages([D(null), D('Solo Cornet')]);
  expect(ps[0]).toMatchObject({ name: 'Unbekannt 1', pages: [0], confidence: 'low', flags: ['unknown'] });
});
it('flags non-consecutive duplicates on both parts', () => {
  const ps = groupPages([D('Solo Cornet'), D('2nd Cornet'), D('Solo Cornet')]);
  expect(ps[0].flags).toContain('duplicate'); expect(ps[2].flags).toContain('duplicate');
});
it('flags a part more than twice the median length', () => {
  const ps = groupPages([D('A Cornet'), D('Solo Horn'), D('1st Horn'), D('2nd Horn'), D(null), D(null)]);
  expect(ps[3].flags).toContain('long');
});
it('carries fuzzy detection as a flag and low confidence', () =>
  expect(groupPages([D('Solo Cornet', 'low')])[0]).toMatchObject({ confidence: 'low', flags: ['fuzzy'] }));
it('covers every page exactly once', () => {
  const ps = groupPages([D(null), D('Solo Cornet'), D(null), D('Timpani'), D('Timpani')]);
  expect(ps.flatMap(p => p.pages)).toEqual([0, 1, 2, 3, 4]);
});
it('returns [] for no pages', () => expect(groupPages([])).toEqual([]));
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Part ids via `nanoid(8)`. A part's confidence is `low` if it has any flag. `long` = page count > 2 × median page count of the file's parts and > 1.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: group detected pages into parts`.

---

### Task 5: Rendering and OCR, proven on generated scans

**Files:**
- Create: `tests/helpers/makeScan.ts`, `src/lib/pdf/render.ts`, `src/lib/ocr/tesseract.ts`, `scripts/probe.ts`, `scripts/fetch-tessdata.mjs`
- Test: `tests/detect/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `makeScanPdf(pages: { left?: string; centre?: string[]; right?: string }[]): Promise<Uint8Array>` — each page is a white A4 raster (1240×1754) with the given header texts drawn at Alladale-like positions and a few staff lines, embedded as one JPEG; no text layer.
  - `openPdf(path: string): Promise<{ pageCount: number; renderHeader(page: number): Promise<Buffer>; renderThumb(page: number, width: number): Promise<Buffer>; close(): Promise<void> }>` — `renderHeader` returns a PNG of the top 25% at 150 dpi; `renderThumb` a JPEG of the full page.
  - `createOcr(): Promise<{ lines(png: Buffer): Promise<OcrLine[]>; close(): Promise<void> }>` — one Tesseract worker, `eng+deu`, language data loaded from `./tessdata` (no network).
  - `detectFile(path: string, onPage?: (done: number, total: number) => void): Promise<PageDetection[]>` exported from `src/lib/detect/index.ts`, composing the three.

- [ ] **Step 1:** Write `scripts/fetch-tessdata.mjs` (downloads `eng.traineddata` and `deu.traineddata` from the `tessdata_fast` GitHub repository into `./tessdata`, skipping existing files); add `"postinstall": "node scripts/fetch-tessdata.mjs"`. Run `npm install` → both files present.
- [ ] **Step 2:** Implement `makeScanPdf` with `@napi-rs/canvas` and `pdf-lib`.
- [ ] **Step 3: Write the failing test**

```ts
it('detects parts on an image-only PDF shaped like the Alladale scan', async () => {
  const sub = ['ALLADALE', 'from Hymn of the Highlands', 'Flugel Horn, Horn & Baritone Trio'];
  const pdf = await makeScanPdf([
    { left: 'Eb Soprano Cornet', centre: sub, right: 'Philip Sparke' },
    { left: 'Solo Bb Cornet', centre: sub, right: 'Philip Sparke' },
    {},                                                      // continuation page
    { left: '1st Bb Baritone', centre: sub, right: 'Philip Sparke' },
  ]);
  const path = join(tmp, 'a.pdf'); await writeFile(path, pdf);
  const parts = groupPages(await detectFile(path));
  expect(parts.map(p => [p.name, p.pages])).toEqual([
    ['Soprano Cornet', [0]], ['Solo Cornet', [1, 2]], ['1st Baritone', [3]],
  ]);
}, 120_000);
```

- [ ] **Step 4:** Run → FAIL.
- [ ] **Step 5:** Implement `render.ts` (pdfjs legacy build for Node, canvas factory from `@napi-rs/canvas`), `tesseract.ts` (map Tesseract line bounding boxes to fractions of the strip), and `detectFile`. Run → PASS.
- [ ] **Step 6:** Implement `scripts/probe.ts <zip-or-folder>`: for every PDF, print `file | page | detected part | confidence | first 60 chars of raw text`, and a per-file summary of parts. Run `npm run probe -- "C:/Users/heini/Downloads/Adventskonzert.zip"`.
- [ ] **Step 7: Tune on the real scans.** For each of the 9 combined files, compare the probe output with the pages. Adjust, in this order, and re-run after each: header strip height (25%), render dpi (150), zone thresholds in Task 3, catalog aliases in Task 2. Every alias or rule added gets a test case in the matching test file. Record the final per-file accuracy (parts correct / parts total) in the commit message. Target: at least 90% of parts correct across the 9 files; if `tesseract.js` cannot reach it, stop and report rather than swapping the engine silently.
- [ ] **Step 8:** Commit: `feat: render, OCR and detect parts on scanned PDFs`.

---

### Task 6: Unpacking uploads and classifying files

**Files:**
- Create: `src/lib/zip/unpack.ts`, `src/lib/classify.ts`
- Test: `tests/zip/unpack.test.ts`, `tests/classify.test.ts`

**Interfaces:**
- Produces:
  - `decodeEntryName(raw: Buffer, utf8Flag: boolean): string`
  - `unpackZip(zipPath: string, destDir: string, maxBytes: number): Promise<{ pieces: { name: string; files: { originalName: string; storedPath: string }[] }[]; ignored: string[]; rootName: string }>` — throws `UploadTooLargeError` when extracted bytes exceed `maxBytes`.
  - `piecesFromLoosePdfs(files: { originalName: string; storedPath: string }[]): { name: string; files: … }[]`
  - `classifyByName(fileName: string): FileClass | null`; `classifyFile(fileName: string, firstPageText: string): FileClass`; `partNameFromFileName(fileName: string, pieceName: string): string | null`

- [ ] **Step 1: Write the failing tests** (build zips in the test with `archiver`; raw-name cases with hand-built buffers)

```ts
it('decodes CP437 and mis-flagged UTF-8 names', () => {
  expect(decodeEntryName(Buffer.from('O Du Fröhliche', 'utf8'), true)).toBe('O Du Fröhliche');
  expect(decodeEntryName(Buffer.from('O Du Fröhliche', 'utf8'), false)).toBe('O Du Fröhliche');
  expect(decodeEntryName(iconv.encode('O Du Fröhliche', 'cp437'), false)).toBe('O Du Fröhliche');
});
it('makes one piece per folder that directly holds PDFs', async () => {
  // Concert/Alladale/a.pdf, Concert/Alladale/b.pdf, Concert/Starlight/c.pdf, Concert/readme.txt
  expect(r.pieces.map(p => [p.name, p.files.length])).toEqual([['Alladale', 2], ['Starlight', 1]]);
  expect(r.ignored).toEqual(['Concert/readme.txt']); expect(r.rootName).toBe('Concert');
});
it('uses the zip name as the piece when PDFs sit at the root', …);            // piece name = zip base name
it('skips entries that escape the destination', async () => {
  // entries: '../evil.pdf', '/abs.pdf', 'ok/a.pdf'
  expect(r.ignored).toEqual(expect.arrayContaining(['../evil.pdf', '/abs.pdf']));
  expect(existsSync(join(dest, '..', 'evil.pdf'))).toBe(false);
});
it('ignores __MACOSX and dotfiles', …);
it('throws UploadTooLargeError past maxBytes', …);
it('names loose PDFs after the first file', () =>
  expect(piecesFromLoosePdfs([{ originalName: 'Alladale - Einzelstimmen.pdf', storedPath: 'x' }])[0].name).toBe('Alladale - Einzelstimmen'));

it.each([
  ['Alladale - Partitur.pdf', 'score'], ['17896 - celtic-crest - score.pdf', 'score'],
  ['X - Full Score.pdf', 'score'], ['Direktion.pdf', 'score'],
  ['Alladale - Einzelstimmen.pdf', 'combined'], ['17896 - celtic-crest - parts.pdf', 'combined'],
  ['Victory (Lord of the Dance), Solo Cornet.pdf', 'single'],
  ['My Love is Alwys Here_260707 - 2nd Bb Trombone.pdf', 'single'],
])('%s → %s', (n, c) => expect(classifyFile(n, '')).toBe(c));
it('falls back to first-page text', () => expect(classifyFile('scan0001.pdf', 'Solo Bb Cornet\nMusic by …')).toBe('single'));
it('defaults to combined', () => expect(classifyFile('scan0001.pdf', '')).toBe('combined'));
it('extracts the part from a file name', () =>
  expect(partNameFromFileName('My Love is Alwys Here_260707 - Bass C Trombone.pdf', 'My Love is Always Here')).toBe('Bass Trombone'));
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Score keywords: `partitur`, `score`, `direktion`, `conductor`. Combined keywords (`einzelstimmen`, `stimmen`, `parts`) win over an instrument match in the file name. Stored files get a `nanoid` name under `destDir` so original names never touch the file system. Path safety: resolve each entry against `destDir` and require the result to stay inside it.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: unpack uploads and classify PDFs`.

---

### Task 7: Splitting and export

**Files:**
- Create: `src/lib/pdf/split.ts`, `src/lib/export.ts`
- Test: `tests/export.test.ts`

**Interfaces:**
- Consumes: `Job`, `makeScanPdf`
- Produces:
  - `extractPages(srcPath: string, pages: number[]): Promise<Uint8Array>`
  - `safeName(s: string): string`
  - `exportProblems(job: Job): { blocking: string[]; warnings: string[] }`
  - `planExport(job: Job): { zipPath: string; srcPath: string; pages: number[] | 'all' }[]`
  - `writeExportZip(job: Job, out: NodeJS.WritableStream): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
it('plans one file per part plus the score', () => {
  expect(planExport(job).map(e => e.zipPath)).toEqual([
    'Adventskonzert/Alladale/Alladale - Partitur.pdf',
    'Adventskonzert/Alladale/Alladale - Soprano Cornet.pdf',
    'Adventskonzert/Alladale/Alladale - Solo Cornet.pdf',
  ]);
});
it('appends (2) to a duplicate name and warns', …);          // '… - Solo Cornet (2).pdf', warnings.length 1
it('numbers a second score', …);                              // '… - Partitur (2).pdf'
it('blocks while a part is named Unbekannt', () =>
  expect(exportProblems(jobWithUnknown).blocking).toEqual(['Alladale: Unbekannt 1']));
it('blocks while a file is still processing', …);
it('skips errored files and warns', …);
it('sanitises illegal characters', () => {
  expect(safeName('Horn 1/2: "solo"?')).toBe('Horn 1-2- -solo--');
  expect(safeName('Victory.')).toBe('Victory');
});
it('omits discarded pages and loses nothing else', async () => {
  // 5-page source, parts [0],[1,2],[3,4], discarded [4]
  // unzip result, load each with pdf-lib: page counts 1, 2, 1 → total 4 = 5 − 1
});
it('copies pages without re-encoding', async () => {
  // the embedded JPEG stream bytes of page 0 in the output equal those in the source
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `single` files export whole as `<Piece> - <Part>.pdf` using `parts[0].name`; `score` files whole. `safeName` replaces `/ \ : * ? " < > |` and control characters with `-` and trims trailing dots and spaces. `writeExportZip` streams with `archiver` (store, no compression: PDFs of JPEGs do not shrink).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: lossless split and zip export`.

---

### Task 8: Job store, edits, pipeline, cleanup

**Files:**
- Create: `src/lib/jobs/store.ts`, `src/lib/jobs/edit.ts`, `src/lib/jobs/process.ts`, `src/lib/jobs/cleanup.ts`, `src/instrumentation.ts`
- Test: `tests/jobs/edit.test.ts`, `tests/jobs/process.test.ts`, `tests/jobs/cleanup.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `createJob(name: string): Promise<Job>`; `readJob(id: string): Promise<Job | null>`; `updateJob(id: string, fn: (j: Job) => Job): Promise<Job>` (serialised per job id, atomic write via temp file + rename); `deleteJob(id: string): Promise<void>`; `jobDir(id: string): string`; `listJobIds(): Promise<string[]>`
  - Job ids are `nanoid(12)`; `readJob` rejects ids not matching `/^[A-Za-z0-9_-]{12}$/`.
  - `type EditOp = { op: 'rename'; fileId: string; partId: string; name: string } | { op: 'split'; fileId: string; partId: string; atPage: number } | { op: 'join'; fileId: string; partId: string } | { op: 'discard'; fileId: string; page: number; discarded: boolean } | { op: 'setClass'; fileId: string; class: FileClass } | { op: 'renamePiece'; pieceId: string; name: string }`
  - `applyEdit(job: Job, op: EditOp): Job` — pure; throws `EditError` on an invalid op.
  - `startJob(jobId: string, upload: { kind: 'zip'; path: string } | { kind: 'pdfs'; files: { originalName: string; storedPath: string }[] }): void`; `resumeUnfinishedJobs(): Promise<void>`
  - `sweepExpiredJobs(now?: number): Promise<string[]>`

- [ ] **Step 1: Write the failing edit tests**

```ts
it('split cuts a part at a page and names the tail Unbekannt', …);   // [1,2,3] atPage 2 → [1],[2,3]; tail 'Unbekannt 1', flagged
it('split at the first page of a part is rejected', …);               // EditError
it('join merges a part into the previous one, keeping the previous name', …);
it('join on the first part is rejected', …);
it('rename trims, clears fuzzy/unknown flags, and recomputes duplicates', …);
it('rename to empty is rejected', …);
it('discard toggles a page without changing any part', …);
it('setClass combined → score collapses parts; back to combined marks the file pending', …);
it('every sequence of valid edits keeps each page in exactly one part', () => {
  // property-style: 200 random split/join ops on a 12-page file; after each, flatMap(pages) equals 0..11
});
```

- [ ] **Step 2:** Implement `store.ts` and `edit.ts`; run → PASS. `setClass` to `combined` on a file without detections sets `status: 'pending'` and the route (Task 9) calls `startJob` again.
- [ ] **Step 3: Write the failing pipeline tests** (inject a fake `detectFile` so they run in milliseconds)

```ts
it('processes a zip into a ready job', async () => {
  // zip: P/a - Partitur.pdf, P/a - parts.pdf (4 pages), P/a - Solo Cornet.pdf
  // expect classes score/combined/single, combined has parts from fake detections, job.status 'ready'
});
it('marks a corrupt PDF as error and finishes the rest', async () => {
  // one entry is the bytes 'not a pdf'
  expect(bad).toMatchObject({ status: 'error' }); expect(bad.error).toMatch(/could not be read/i);
  expect(job.status).toBe('ready');
});
it('marks an encrypted PDF as error', …);
it('resumes files left pending or processing', async () => {
  // write a job.json with file statuses done, processing, pending; call resumeUnfinishedJobs()
  // fake detectFile called exactly twice; job ends 'ready'
});
it('updates progress as pages finish', …);                    // file.progress { done, total } visible via readJob mid-run
```

  Add `progress?: { done: number; total: number }` to `SourceFile` in `types.ts`.

- [ ] **Step 4:** Implement `process.ts`: unpack → classify (first-page text via pdfjs `getTextContent`) → for `single`, one part named from file name or text → for `combined`, `detectFile` + `groupPages` → status `done`. Files run one at a time; pages within a file run `ocrConcurrency` at a time. Each file is wrapped so a throw sets `status: 'error'`. Run → PASS.
- [ ] **Step 5: Write the failing cleanup test, then implement**

```ts
it('deletes jobs older than the TTL and keeps newer ones', async () => {
  expect(await sweepExpiredJobs(Date.parse(old.createdAt) + 24 * 3600_000 + 1)).toEqual([old.id]);
  expect(await readJob(fresh.id)).not.toBeNull();
});
```

- [ ] **Step 6:** `src/instrumentation.ts` `register()`: on the Node runtime only, call `resumeUnfinishedJobs()` and schedule `sweepExpiredJobs()` hourly.
- [ ] **Step 7:** Run `npm test` → PASS. Commit: `feat: job store, edit operations and processing pipeline`.

---

### Task 9: HTTP API

**Files:**
- Create: `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/[id]/files/[fileId]/pages/[page]/route.ts`, `src/app/api/jobs/[id]/export/route.ts`, `src/app/api/health/route.ts`
- Test: `tests/api/jobs.test.ts` (calls the route handlers directly with `Request` objects)

**Interfaces:**
- Produces:

| Route | Behaviour |
|---|---|
| `POST /api/jobs` | multipart, field `files` (one zip or 1..n PDFs). Streams to disk. → `201 { id }`. `400` if no PDF or zip; `413` over `MAX_UPLOAD_MB`. |
| `GET /api/jobs/:id` | → `Job` plus `problems: { blocking, warnings }`. `404` unknown. |
| `PATCH /api/jobs/:id` | body `EditOp` → updated job as above. `400` on `EditError`. |
| `DELETE /api/jobs/:id` | → `204`. |
| `GET …/files/:fileId/pages/:page?w=240` | JPEG thumbnail, `w` clamped 80..1600, cached on disk under the job dir, `Cache-Control: private, max-age=86400`. |
| `GET /api/jobs/:id/export` | zip stream, `Content-Disposition: attachment; filename="<job name>.zip"`. `409` with `{ blocking }` if blocked. |
| `GET /api/health` | `200 { ok: true }`. |

- [ ] **Step 1: Write the failing tests:** one per row above, plus: upload over the limit returns 413 and leaves no job directory; `GET` with id `../x` returns 404; export of a blocked job returns 409 listing `Unbekannt 1`; an upload of two loose PDFs creates one piece.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Enforce the size limit while streaming (count bytes, abort and delete on overflow), not from `Content-Length` alone. All handlers `export const runtime = 'nodejs'`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: job API`.

---

### Task 10: Interface

**Files:**
- Create: `src/lib/i18n/en.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/jobs/[id]/page.tsx`, `src/components/{upload-dropzone,piece-section,part-group,page-thumb,page-lightbox,part-name-input,export-bar,theme-toggle}.tsx`, `src/lib/client/use-job.ts`
- Test: `e2e/split.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: the API in Task 9; `STANDARD_PARTS` for name suggestions
- Produces: `useJob(id)` → `{ job, problems, edit(op: EditOp), isLoading }`, polling `GET /api/jobs/:id` every 1.5 s while `job.status === 'processing'`, with optimistic edits.

- [ ] **Step 1: Mockup first.** Build the review screen as a static page at `src/app/mockup/page.tsx` with hard-coded data for two pieces (one with a flagged part, one still processing), in light and dark. Design direction from the spec: paper-like and calm, a serif (Fraunces) for piece titles, Inter for UI, one warm accent, large thumbnails as the main visual. **Stop and show the owner; do not continue until they approve the look.** Delete the mockup route afterwards.
- [ ] **Step 2: Write the failing end-to-end test**

```ts
test('upload, fix a split, export', async ({ page }) => {
  // zip built in the test with makeScanPdf: piece "Test Piece" with a 5-page parts scan
  // (Soprano Cornet, Solo Cornet ×2 pages, an unlabelled page that is really 1st Horn, Timpani) and a score
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(zipPath);
  await expect(page).toHaveURL(/\/jobs\//);
  await expect(page.getByTestId('part-group')).toHaveCount(3, { timeout: 120_000 }); // unlabelled page joined Solo Cornet
  await page.getByTestId('cut-after-page-2').click();                                // split it off
  await expect(page.getByRole('button', { name: 'Download zip' })).toBeDisabled();   // Unbekannt blocks export
  await page.getByTestId('part-name').nth(2).fill('1st Horn');
  await page.getByTestId('part-name').nth(2).press('Enter');
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download zip' }).click()]);
  // unzip: 5 files; 'Test Piece - 1st Horn.pdf' has 1 page; page counts sum to 5 + score pages
});
```

- [ ] **Step 3:** Run `npx playwright test` → FAIL.
- [ ] **Step 4:** Implement the upload page: full-page drop target, accepts `.zip` and `.pdf`, upload progress via `XMLHttpRequest`, redirect to `/jobs/:id`. Errors (413, 400) shown inline.
- [ ] **Step 5:** Implement the review page:
  - Sticky header: job name, counts (pieces / parts / to check), expiry time, delete button, export bar.
  - One section per piece: editable title, per-file progress bar while processing, error card for failed files, a class switcher per file.
  - Parts as groups of thumbnails in page order. Between any two adjacent pages a cut control (`data-testid="cut-after-page-<n>"`): inside a part it splits, on a part boundary it joins.
  - Part name as an inline input with suggestions from `STANDARD_PARTS`; low-confidence parts get the accent outline and a tooltip naming the flags in words.
  - Click a thumbnail → lightbox at `w=1600` with previous/next and a discard toggle; discarded pages render dimmed with a strike.
  - Export bar: disabled with the blocking list while blocked; warnings shown but not blocking.
  - A "to check" filter that scrolls between flagged parts.
  - Thumbnails lazy-load (`loading="lazy"`, fixed aspect ratio 1:1.414 to avoid layout shift).
- [ ] **Step 6:** Run `npx playwright test` → PASS. Check manually at tablet width (820 px) and in dark mode.
- [ ] **Step 7:** Commit: `feat: upload and review interface`.

---

### Task 11: Packaging and documentation

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `docs/screenshot.png`

**Interfaces:**
- Consumes: `GET /api/health`, env variables from Global Constraints

- [ ] **Step 1:** `Dockerfile`, multi-stage on `node:22-bookworm-slim`: deps → build (`npm run build`, tessdata fetched) → runtime copying `.next/standalone`, `.next/static`, `public`, `tessdata`; `USER node`; `ENV DATA_DIR=/data`; `VOLUME /data`; `EXPOSE 3000`; `HEALTHCHECK` on `/api/health`.
- [ ] **Step 2:** `docker-compose.yml`:

```yaml
services:
  score-splitter:
    image: ghcr.io/OWNER/score-splitter:latest
    container_name: score-splitter
    restart: unless-stopped
    ports:
      - "3210:3000"
    environment:
      MAX_UPLOAD_MB: "500"
      JOB_TTL_HOURS: "24"
      OCR_CONCURRENCY: "2"
    volumes:
      - score-splitter-data:/data
volumes:
  score-splitter-data:
```

  `OWNER` is replaced with the GitHub account once the owner names it.

- [ ] **Step 3:** Verify, in three checks:
  1. `docker build -t score-splitter .`, then `docker run --rm -p 3210:3000 score-splitter`; upload the generated test zip in the browser and export it.
  2. Offline OCR: add `scripts/ocr-selfcheck.mjs` (generates one page reading "Solo Cornet", runs `detectFile`, prints the part name) and copy it into the image. `docker run --rm --network none score-splitter node scripts/ocr-selfcheck.mjs` → prints `Solo Cornet`.
  3. `docker run --rm score-splitter id -u` → not `0`.
- [ ] **Step 4:** `ci.yml`: on push and PR — `npm ci`, lint, `npm test`, Playwright. `release.yml`: on tag `v*` — buildx for `linux/amd64,linux/arm64`, push to GHCR with tags `latest` and the version.
- [ ] **Step 5:** `README.md`: what it does (with screenshot from the e2e run on generated pages, never real music), quick start with `docker compose up -d`, "Deploy on Umbrel with Arcane" (create a project in Arcane, paste the compose file, deploy, open `http://umbrel.local:3210`), configuration table, how detection works, how to add part-name variants (`src/lib/parts/catalog.ts` + a test case), development setup, licence.
- [ ] **Step 6:** Commit: `chore: Docker image, CI and README`.

---

## Open items for the owner

- GitHub account or organisation name, for the image path and README.
- Approval of the mockup in Task 10, Step 1.
- Host port on the Umbrel (`3210` assumed free).
