export type Confidence = 'high' | 'low';

/** Transposition printed next to a part name; tells treble- and bass-clef variants apart. */
export type PartKey = 'Bb' | 'Eb' | 'C';

export type PartMatch = { name: string; exact: boolean; key: PartKey | null };

/** Coordinates are fractions 0..1 of the rendered header strip. */
export type OcrLine = { text: string; x0: number; x1: number; y0: number; y1: number };

/** Clockwise turn, in degrees, that makes a page read upright. */
export type Rotation = 0 | 90 | 180 | 270;

export type PageDetection = {
  partName: string | null;
  confidence: Confidence;
  /** All text found in the page header, one label per line. */
  rawText: string;
  key: PartKey | null;
  /** The turn that makes the page upright, as far as it could be told. Absent means 0. */
  rotation?: Rotation;
};

export type FileClass = 'score' | 'single' | 'combined';

export type PartFlag = 'fuzzy' | 'long' | 'duplicate' | 'unknown';

/** `pages` are zero-based indexes into the source PDF, contiguous and ascending. */
export type Part = {
  id: string;
  name: string;
  pages: number[];
  confidence: Confidence;
  flags: PartFlag[];
};

export type SourceFile = {
  id: string;
  originalName: string;
  storedPath: string;
  pageCount: number;
  class: FileClass;
  parts: Part[];
  discarded: number[];
  /**
   * For each page, the clockwise turn that makes it upright; absent when
   * every page already is. Thumbnails and exported parts are turned by it.
   */
  rotations?: Rotation[];
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
  progress?: { done: number; total: number };
};

export type Piece = { id: string; name: string; files: SourceFile[] };

export type Job = {
  id: string;
  name: string;
  createdAt: string;
  status: 'processing' | 'ready';
  pieces: Piece[];
  ignored: string[];
};
