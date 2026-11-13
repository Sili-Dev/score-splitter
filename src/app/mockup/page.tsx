'use client';

// Design mockup of the review screen with made-up data. Deleted once the look is approved.
import { useState } from 'react';
import { ReviewScreen } from '@/components/review-screen';
import { applyEditToView } from '@/lib/client/optimistic';
import type { FileView, JobView } from '@/lib/jobs/view';
import type { Part, PartFlag } from '@/lib/types';

let nextId = 0;
const part = (name: string, pages: number[], flags: PartFlag[] = []): Part => ({
  id: `p${nextId++}`,
  name,
  pages,
  confidence: flags.length ? 'low' : 'high',
  flags,
});

function combined(id: string, name: string, parts: Part[]): FileView {
  return {
    id,
    originalName: name,
    pageCount: parts.reduce((n, p) => n + p.pages.length, 0),
    class: 'combined',
    parts,
    discarded: [],
    status: 'done',
  };
}

const score = (id: string, name: string, pageCount: number): FileView => ({
  id,
  originalName: name,
  pageCount,
  class: 'score',
  parts: [],
  discarded: [],
  status: 'done',
});

const initial: JobView = {
  id: 'mockupmockup',
  name: 'Adventskonzert',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 23 * 3600_000).toISOString(),
  status: 'processing',
  ignored: [],
  problems: { blocking: ['Alladale: Unbekannt 1'], warnings: [] },
  pieces: [
    {
      id: 'a',
      name: 'Alladale',
      files: [
        combined('a1', 'Alladale - Einzelstimmen.pdf', [
          part('Soprano Cornet', [0]),
          part('Solo Cornet', [1]),
          part('Repiano Cornet', [2]),
          part('2nd Cornet', [3]),
          part('3rd Cornet', [4]),
          part('Flugelhorn', [5]),
          part('Solo Horn', [6]),
          part('1st Horn', [7], ['fuzzy']),
          part('2nd Horn', [8]),
          part('Euphonium', [9, 10]),
          part('1st Baritone', [11]),
          part('Unbekannt 1', [12], ['unknown']),
          part('1st Trombone', [13]),
          part('2nd Trombone', [14]),
          part('Bass Trombone', [15]),
          part('Eb Bass', [16, 17]),
          part('Bb Bass', [18]),
          part('Timpani', [19]),
          part('Percussion 1', [20]),
        ]),
        score('a2', 'Alladale - Partitur.pdf', 12),
      ],
    },
    {
      id: 'b',
      name: 'So Many Lives',
      files: [
        combined('b1', 'Einzelstimmen.pdf', [
          part('Soprano Cornet', [0]),
          part('Solo Cornet', [1], ['duplicate']),
          part('Solo Cornet', [2], ['duplicate']),
          part('Repiano Cornet', [3]),
          part('1st Trombone (Bb)', [4]),
          part('1st Trombone (C)', [5]),
          part('Drum Set', [6, 7, 8]),
        ]),
      ],
    },
    {
      id: 'c',
      name: 'Celtic Crest',
      files: [
        {
          id: 'c1',
          originalName: '17896 - celtic-crest - parts.pdf',
          pageCount: 29,
          class: 'combined',
          parts: [],
          discarded: [],
          status: 'processing',
          progress: { done: 11, total: 29 },
        },
        { id: 'c2', originalName: '17896 - celtic-crest - score.pdf', pageCount: 0, class: 'combined', parts: [], discarded: [], status: 'pending' },
      ],
    },
  ],
};

const titles: Record<string, string> = { a1: 'ALLADALE', a2: 'ALLADALE', b1: 'SO MANY LIVES', c1: 'CELTIC CREST' };

/** A stand-in page: title block, part name at the left margin, staves. */
function fakePage(job: JobView, fileId: string, page: number): string {
  const file = job.pieces.flatMap((p) => p.files).find((f) => f.id === fileId);
  const owner = file?.parts.find((p) => p.pages.includes(page));
  const first = owner ? owner.pages[0] === page : page === 0;
  const label = file?.class === 'score' ? 'Full Score' : (owner?.name ?? '');
  const staves = Array.from({ length: first ? 8 : 10 }, (_, s) => {
    const top = (first ? 74 : 26) + s * 23;
    const lines = Array.from({ length: 5 }, (_, l) => `<path d="M14 ${top + l * 2.6}H186" stroke="#222" stroke-width=".35"/>`).join('');
    const notes = Array.from({ length: 14 }, (_, n) => {
      const x = 22 + n * 11.5 + ((page * 7 + s * 3 + n) % 4);
      const y = top + ((page + s * 5 + n * 3) % 9) * 1.3;
      return `<ellipse cx="${x}" cy="${y}" rx="1.9" ry="1.4" fill="#222"/><path d="M${x + 1.8} ${y}v-7" stroke="#222" stroke-width=".4"/>`;
    }).join('');
    return lines + notes;
  }).join('');
  const header = first
    ? `<text x="100" y="24" text-anchor="middle" font-family="Georgia,serif" font-size="13" font-weight="700" fill="#111">${titles[fileId] ?? ''}</text>
       <text x="100" y="36" text-anchor="middle" font-family="Georgia,serif" font-size="5.5" fill="#333">for brass band</text>
       <text x="14" y="56" font-family="Georgia,serif" font-size="7" fill="#111">${label.startsWith('Unbekannt') ? '' : label}</text>
       <text x="186" y="56" text-anchor="end" font-family="Georgia,serif" font-size="6" fill="#111">arr. A. Composer</text>`
    : `<text x="100" y="14" text-anchor="middle" font-family="Georgia,serif" font-size="5" fill="#333">- ${page - (owner?.pages[0] ?? 0) + 1} -</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 283"><rect width="200" height="283" fill="#fdfcf8"/>${header}${staves}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function Mockup() {
  const [job, setJob] = useState(initial);
  return (
    <ReviewScreen
      job={job}
      onEdit={(op) => {
        try {
          setJob((j) => ({ ...applyEditToView(j, op), status: 'processing' }));
        } catch {
          // the mockup ignores edits that make no sense
        }
      }}
      onDelete={() => undefined}
      onDownload={() => undefined}
      thumbSrc={(fileId, page) => fakePage(job, fileId, page)}
    />
  );
}
