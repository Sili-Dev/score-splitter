export type Confidence = 'high' | 'low';

export type PartMatch = { name: string; exact: boolean };

/** Coordinates are fractions 0..1 of the rendered header strip. */
export type OcrLine = { text: string; x0: number; x1: number; y0: number; y1: number };

export type PageDetection = { partName: string | null; confidence: Confidence; rawText: string };

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
