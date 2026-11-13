# Score Splitter — Design

Date: 2026-11-13
Status: awaiting approval

Items marked **(my call)** were decided by Claude, not by the owner, and can be
overruled.

## Intent

A brass band receives the sheet music for a concert as a zip of PDFs. Most
pieces come as one combined scan holding every part in sequence. Before the
players can use them, someone has to cut that scan into one PDF per part
(Solo Cornet, 1st Baritone, 2nd Baritone, 1st Trombone, …) and upload the
result to the band's cloud.

Score Splitter does the cutting. The owner uploads the zip, checks the splits
the tool proposes, and downloads a tidy zip that goes straight into the band's
cloud.

## Goals

- Accept a zip, or one or more PDFs, by drag and drop.
- Detect where each part begins in a combined parts PDF, for parts of any
  length (one page today, more than two in future).
- Let the owner review and correct every proposed split before export.
- Export one zip: one folder per piece, one PDF per part, with the same part
  name used for the same instrument in every piece.
- Look good. This is a public, open-source repository and the interface should
  be something worth showing.
- Run as a single container on the owner's Umbrel, deployed through Arcane.

## Non-goals

- Uploading directly to the band's cloud. Export is download-only **(my call)**.
- A permanent library. Nothing is kept after export.
- Accounts or login. The app is assumed to be reachable only on the home
  network **(my call)**.
- Splitting the full score. It is passed through whole.
- Recognising the music itself, transposing, or editing page content.

## Anti-goals

- A split that silently loses or duplicates a page. Every page of an input PDF
  must end up in exactly one output file, or be explicitly discarded by the
  owner in the review screen.
- Re-encoding the scans. Pages are copied as they are; output quality equals
  input quality.
- Sending the sheet music to any third party.
- Copyrighted sheet music in the public repository, including as test data.

## What the input looks like

Taken from the owner's example, `Adventskonzert.zip` (10 pieces, 41 PDFs, 76 MB):

| Kind | Pieces | File contents |
|---|---|---|
| Scan, `… Einzelstimmen.pdf` + `… Partitur.pdf` | 5 | One JPEG per page, 19–30 pages, no text layer |
| Xerox copier scan, `… parts.pdf` + `… score.pdf` | 4 | One bilevel image per page, 23–29 pages; only text is an order-number watermark |
| Already split, one digital PDF per part | 1 | 22 files, part name in the filename and in the page text |

Consequences:

- No combined parts PDF has usable text, so part names must come from OCR.
- A piece can mix kinds: "Victory" has a combined parts scan plus a separate
  Solo Cornet PDF.
- File names are German or English: Einzelstimmen/parts, Partitur/score.
- Folder names can arrive with broken umlauts (`O Du Fr+Âhliche`) because the
  zip stores names in a legacy encoding.

Where the part name sits, from a page of "Alladale" the owner supplied after
approval: at the left margin, within the top fifth of the page, level with the
subtitle ("E♭ Soprano Cornet"). Two traps are visible on that page:

- The centred subtitle reads "Flugel Horn, Horn & Baritone Trio". It contains
  three instrument names and is not the part name. Matching any instrument
  word in the header would mislabel every page of this piece.
- The key is printed with a flat sign (E♭), which OCR renders unpredictably
  ("Eb", "E>", "Ey"). The key must be optional in matching.

Other editions may print the part name elsewhere in the header, so position is
a preference, not a hard rule.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A | OCR on the server (Tesseract), match against an instrument list | Free, private, offline. Misreads some scans, so a review step is required. |
| B | Cloud vision model names each page | More accurate on poor scans. Costs money per upload, needs an API key, sends the music to a third party. |
| C | Everything in the browser, no server | Simplest hosting. Slow and memory-hungry for a 76 MB zip, unusable on a phone. |

**Chosen: A.** The owner left technical choices to Claude and accepted this
pick. A keeps the music on the Umbrel and costs nothing to run. B conflicts
with the no-third-party anti-goal as a default; the detector is kept behind an
interface so B could be added later as an opt-in setting.

## How it works

### 1. Upload

One upload creates a **job**. A zip is unpacked; each folder that directly
contains PDFs is a **piece**, named after the folder. Loose PDFs uploaded
without a zip form one piece named after the first file **(my call)**. File
names in the zip are decoded as UTF-8 when flagged, otherwise as CP437 with a
fallback attempt at UTF-8, so umlauts survive. Non-PDF files are ignored and
listed in the job summary.

### 2. Classifying each PDF

Each PDF in a piece is classified, in this order:

1. **Score** — file name contains `partitur`, `score`, `full score`, or
   `direktion`. Passed through whole.
2. **Single part** — the file name or the first page's text matches exactly one
   instrument. Passed through whole and renamed.
3. **Combined parts** — everything else. Goes through page detection.

The owner can change a file's class in the review screen.

### 3. Page detection (combined parts)

For each page:

1. Render the page to an image at about 150 dpi.
2. OCR the top quarter of the page **(my call; tune against the real scans)**.
3. Fuzzy-match the OCR text against the instrument list. A match needs an
   instrument word (cornet, horn, baritone, …) and takes any rank (solo, 1st,
   2nd, repiano, …) and key (Bb, Eb, C) found next to it.
4. Choose among matching lines. A line naming two or more different
   instruments (a subtitle such as "Flugel Horn, Horn & Baritone Trio") is not
   a part name; "2nd & 3rd Cornet" names one instrument and is. Among the
   rest, prefer the line nearest the left margin, then the right margin, then
   the centre.

Then, in page order:

- A page with a match **starts a new part**.
- A page without a match **continues the previous part**. This is what handles
  parts of three or more pages.
- If consecutive pages match the same part, the later ones continue it rather
  than starting a duplicate; some editions repeat the part name on every page.
- Pages before the first match form a part named `Unbekannt 1` and are flagged.

Each part gets a confidence: high when the match was exact, low when it was
fuzzy, when the part is unusually long compared to its neighbours, or when the
same name appears twice in a piece. Low-confidence parts are highlighted in
the review screen.

### 4. Part names

The tool holds one list of standard names and the variants that map to them.
Standard names are English brass band terms **(my call)**:

Soprano Cornet, Solo Cornet, Repiano Cornet, 2nd Cornet, 3rd Cornet,
Flugelhorn, Solo Horn, 1st Horn, 2nd Horn, 1st Baritone, 2nd Baritone,
1st Trombone, 2nd Trombone, Bass Trombone, 1st Euphonium, 2nd Euphonium,
Eb Bass, Bb Bass, Timpani, Percussion, plus individual percussion parts
(Glockenspiel, Drum Set, …) kept under their own names.

A header naming two parts ("2nd & 3rd Cornet") stays one file named
`2nd + 3rd Cornet` **(my call)**.

Variants cover key letters ("Solo Bb Cornet"), German names ("Es-Horn",
"Posaune", "Schlagzeug"), and common OCR slips. A name that matches nothing is
kept as OCR read it and flagged. The list lives in one data file so that
contributors can extend it without touching logic.

### 5. Review

One screen per job. Pieces are listed down the page; each piece shows its
parts as groups of page thumbnails in original order.

```
Alladale                                   23 pages · 21 parts · 2 to check
┌ Soprano Cornet ─┐ ┌ Solo Cornet ──────────┐ ┌ ⚠ Repiano Cornet ? ┐
│ [p1]            │ │ [p2] [p3]             │ │ [p4]               │
└─────────────────┘ └───────────────────────┘ └────────────────────┘
       ✂ click between two pages to split or join there
```

The owner can:

- rename a part (free text, with suggestions from the standard list)
- split a part between any two pages, or join it with its neighbour
- open a page large to read it
- mark a page as discarded (blank backs, cover sheets)
- change a file's class (score / single part / combined)

Page order never changes; only the cut positions and names do. That keeps the
"every page exactly once" guarantee simple to hold.

### 6. Export

One zip named after the upload:

```
Adventskonzert/
  Alladale/
    Alladale - Partitur.pdf
    Alladale - Soprano Cornet.pdf
    Alladale - Solo Cornet.pdf
    …
```

- File name pattern: `<Piece> - <Part>.pdf`.
- Scores are named `<Piece> - Partitur.pdf` **(my call)**.
- Two parts with the same name in one piece get ` (2)` appended and a warning
  before export.
- Export is blocked while a part is still named `Unbekannt …`; the owner must
  name or discard it.
- Pages are copied object-for-object from the source PDF, not re-rendered.

### 7. Lifetime

Jobs live on disk under one data directory. A job and all its files are
deleted 24 hours after creation **(my call)**, and the owner can delete one
immediately. A job's review screen has its own URL, so closing the tab does
not lose work within that window.

## Look and feel

Calm and paper-like rather than a generic admin panel: generous white space,
a serif for piece titles echoing engraved sheet music, one warm accent colour,
large page thumbnails as the main visual element. Light and dark themes.
Interface text in English **(my call)**, structured so a German translation
can be added. Works on a tablet; phone support is limited to upload and
download.

The detailed visual design is left to the builder, to be shown to the owner as
a mockup before the review screen is built.

## Technology (all my call)

| Concern | Choice | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript, one process | UI and server in one deployable unit |
| Styling | Tailwind CSS + shadcn/ui components | Polished result without a custom component library |
| Page rendering | `pdfjs-dist` with `@napi-rs/canvas` | Handles the JPEG and bilevel scans; permissive licence |
| OCR | `tesseract.js` with English and German data bundled in the image | No native install, so `npm run dev` works on Windows; works offline |
| Splitting | `pdf-lib` page copying | Lossless |
| Zip | `yauzl` to read, `archiver` to write | Streaming, so large uploads stay off the heap |
| Tests | Vitest for logic, Playwright for one end-to-end run | |
| Licence | MIT | |

Detection runs as a background task inside the server process, a few pages in
parallel. The review screen shows progress per piece and becomes usable piece
by piece as detection finishes. If `tesseract.js` proves too slow or too
inaccurate on the real scans, the builder may switch to the native `tesseract`
binary inside the container; the detector interface stays the same.

Limits, set by environment variables: maximum upload size (default 500 MB),
job lifetime (default 24 h), OCR parallelism (default 2).

## Deployment

- A multi-stage `Dockerfile` producing one image, for `amd64` and `arm64`.
- A GitHub Actions workflow that builds and publishes the image to GitHub
  Container Registry on each release tag.
- A `docker-compose.yml` in the repository root with one service, one port,
  and one named volume for the data directory. This is the file the owner
  pastes into Arcane on the Umbrel.
- The container runs as a non-root user and needs no outbound network access.

## Testing

- **Name matching:** table-driven tests over OCR-like strings, including the
  part names from the example's "My Love is Always Here" set and German
  variants.
- **Part grouping:** tests on sequences of per-page detection results (start,
  continue, repeated name, unmatched first pages, a four-page part).
- **Splitting:** generated PDFs; assert that output page counts add up to the
  input and that every page appears exactly once.
- **End to end:** a synthetic zip generated in the test run — pages with a part
  name drawn as an image so that OCR is exercised — uploaded, exported, and
  checked.
- **Real scans:** the owner's example zip is used locally to tune detection.
  It stays outside the repository and is listed in `.gitignore`.

## Left to the builder

- The exact OCR region, resolution, and matching thresholds, tuned on the real
  scans. The first implementation step should be to render sample pages and
  confirm where the part name sits.
- The visual design, within the direction above.
- The full variant list for part names.
- Internal module layout and the shape of the job API.

## Repository

`C:\workspace\score-splitter`, working name "Score Splitter" **(my call)**.
README with a screenshot, a one-command quick start, and the Umbrel/Arcane
steps.
