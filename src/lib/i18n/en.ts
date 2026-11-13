import type { FileClass, PartFlag } from '@/lib/types';

/** All interface text. A translation is a second file with the same shape. */
export const t = {
  appName: 'Score Splitter',
  tagline: 'One PDF per part, ready for the band.',

  upload: {
    heading: 'Split a band set into its parts',
    lead: 'Drop the zip or the PDFs you were sent. You get back one PDF per part, named the same way for every piece.',
    drop: 'Drop a zip or PDFs here',
    dropActive: 'Let go to upload',
    browse: 'Choose files',
    uploading: (percent: number) => `Uploading… ${percent}%`,
    unpacking: 'Unpacking…',
    steps: [
      ['Upload', 'A zip with one folder per piece, or the PDFs of a single piece.'],
      ['Check', 'Each part is found by reading the page headers. You fix what it got wrong.'],
      ['Download', 'One zip, one folder per piece, one PDF per part.'],
    ] as const,
    privacy: (hours: number) => `Uploads stay on this server and are deleted after ${hours} hours.`,
    failed: 'The upload did not go through. Check the connection and try again.',
  },

  review: {
    back: 'New upload',
    pieces: (n: number) => (n === 1 ? '1 piece' : `${n} pieces`),
    parts: (n: number) => (n === 1 ? '1 part' : `${n} parts`),
    pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
    toCheck: (n: number) => `${n} to check`,
    allClear: 'Nothing to check',
    reading: 'Reading pages…',
    expires: (when: string) => `Deleted ${when}`,
    delete: 'Delete upload',
    deleteConfirm: 'Delete this upload and everything in it?',
    download: 'Download zip',
    nextToCheck: 'Next to check',
    blocked: (n: number) => (n === 1 ? '1 part needs a name before you can download.' : `${n} parts need a name before you can download.`),
    stillReading: 'Still reading pages. You can already check the pieces that are done.',
    ignored: (n: number) => (n === 1 ? '1 file in the upload was not a PDF and was left out.' : `${n} files in the upload were not PDFs and were left out.`),
    gone: 'This upload no longer exists. Uploads are deleted after a day.',
    loadFailed: 'The upload could not be loaded.',
    editFailed: 'That change could not be saved.',
    renamePiece: 'Rename piece',
  },

  file: {
    kind: { score: 'Score', single: 'Single part', combined: 'Set of parts' } satisfies Record<FileClass, string>,
    kindHint: 'What this file is',
    waiting: 'Waiting…',
    readingPage: (done: number, total: number) => `Reading page ${done} of ${total}`,
    readingStart: 'Opening…',
    scoreNote: (pages: number) => `Kept whole as the score, ${pages === 1 ? '1 page' : `${pages} pages`}.`,
    retryAs: 'Read it as',
  },

  part: {
    namePlaceholder: 'Name this part',
    nameLabel: 'Part name',
    flag: {
      fuzzy: 'Check the name',
      long: 'Unusually long',
      duplicate: 'Name used twice',
      unknown: 'Needs a name',
    } satisfies Record<PartFlag, string>,
    flagHint: {
      fuzzy: 'The name was hard to read on the page. Check that it is right.',
      long: 'This part has many more pages than the others. A part start may have been missed.',
      duplicate: 'Another part in this piece has the same name. Rename one, or discard it if it is a spare copy.',
      unknown: 'No part name was found on this page. Type one, or join it to the part before.',
    } satisfies Record<PartFlag, string>,
    split: 'Start a new part here',
    join: 'Join with the part before',
    discard: 'Leave this part out',
    restore: 'Put this part back',
    discarded: 'Left out',
  },

  page: {
    open: (n: number) => `Open page ${n}`,
    label: (n: number, total: number) => `Page ${n} of ${total}`,
    discard: 'Leave this page out',
    restore: 'Put this page back',
    previous: 'Previous page',
    next: 'Next page',
    close: 'Close',
  },

  theme: { toggle: 'Switch between light and dark' },
};
