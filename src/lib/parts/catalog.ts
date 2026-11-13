/**
 * Part-name data. To teach the tool a new spelling, add it to `aliases`
 * (a correct spelling in any language) or `slips` (a known OCR misreading)
 * and add a case to tests/parts/match.test.ts.
 *
 * All aliases are lowercase, without punctuation; multi-word aliases are
 * separated by single spaces.
 */

export type Instrument = {
  /** Groups aliases that mean the same instrument. */
  family: string;
  /** Name used in exported file names. */
  display: string;
  aliases: string[];
  slips?: string[];
  /** "ranked" takes Solo/1st/2nd, "keyed" keeps its key (Eb Bass), "numbered" keeps a trailing number. */
  kind: 'ranked' | 'keyed' | 'numbered';
};

export const INSTRUMENTS: Instrument[] = [
  { family: 'cornet', display: 'Cornet', kind: 'ranked', aliases: ['cornet', 'cornets', 'kornett'], slips: ['comet', 'cornel', 'comnet', 'coronet'] },
  { family: 'flugelhorn', display: 'Flugelhorn', kind: 'ranked', aliases: ['flugelhorn', 'flugel horn', 'flügelhorn', 'fluegelhorn', 'flugel', 'flügel'] },
  { family: 'horn', display: 'Horn', kind: 'ranked', aliases: ['horn', 'tenor horn', 'tenorhorn'], slips: ['hom'] },
  { family: 'althorn', display: 'Althorn', kind: 'ranked', aliases: ['althorn', 'alto horn'] },
  { family: 'trumpet', display: 'Trumpet', kind: 'ranked', aliases: ['trumpet', 'trompete'] },
  { family: 'clarinet', display: 'Clarinet', kind: 'ranked', aliases: ['clarinet', 'klarinette', 'klarinet'] },
  { family: 'altoclarinet', display: 'Alto Clarinet', kind: 'ranked', aliases: ['alto clarinet', 'altklarinette', 'altklarinet'] },
  { family: 'bassclarinet', display: 'Bass Clarinet', kind: 'ranked', aliases: ['bass clarinet', 'bassklarinette', 'bassklarinet'] },
  { family: 'sopranosax', display: 'Soprano Saxophone', kind: 'ranked', aliases: ['soprano saxophone', 'soprano saxophon', 'sopransaxophon', 'soprano sax'] },
  { family: 'altosax', display: 'Alto Saxophone', kind: 'ranked', aliases: ['alto saxophone', 'alto saxophon', 'altsaxophon', 'alto sax'] },
  { family: 'tenorsax', display: 'Tenor Saxophone', kind: 'ranked', aliases: ['tenor saxophone', 'tenor saxophon', 'tenorsaxophon', 'tenor sax'] },
  { family: 'sax', display: 'Saxophone', kind: 'ranked', aliases: ['saxophone', 'saxophon', 'sax'] },
  { family: 'baritone', display: 'Baritone', kind: 'ranked', aliases: ['baritone', 'bariton'], slips: ['bantone'] },
  { family: 'trombone', display: 'Trombone', kind: 'ranked', aliases: ['trombone', 'posaune'] },
  { family: 'euphonium', display: 'Euphonium', kind: 'ranked', aliases: ['euphonium'] },
  { family: 'bass', display: 'Bass', kind: 'keyed', aliases: ['bass', 'basses', 'tuba'] },
  { family: 'timpani', display: 'Timpani', kind: 'numbered', aliases: ['timpani', 'pauken', 'timp'] },
  { family: 'percussion', display: 'Percussion', kind: 'numbered', aliases: ['percussion', 'schlagzeug', 'perc', 'schlagwerk'] },
  { family: 'drumset', display: 'Drum Set', kind: 'numbered', aliases: ['drum set', 'drum kit', 'drumset', 'drums'] },
  { family: 'glockenspiel', display: 'Glockenspiel', kind: 'numbered', aliases: ['glockenspiel', 'glock'] },
  { family: 'lyra', display: 'Lyra', kind: 'numbered', aliases: ['lyra'] },
  { family: 'congas', display: 'Congas', kind: 'numbered', aliases: ['congas', 'conga'] },
  { family: 'tambourine', display: 'Tambourine', kind: 'numbered', aliases: ['tambourine', 'tambourin', 'tamburin'] },
  { family: 'suspendedcymbal', display: 'Suspended Cymbal', kind: 'numbered', aliases: ['suspended cymbal', 'sus cymbal', 'susp cymbal'] },
  { family: 'cymbals', display: 'Cymbals', kind: 'numbered', aliases: ['cymbals', 'cymbal', 'becken', 'cim'] },
  { family: 'xylophone', display: 'Xylophone', kind: 'numbered', aliases: ['xylophone', 'xylophon'] },
  { family: 'vibraphone', display: 'Vibraphone', kind: 'numbered', aliases: ['vibraphone', 'vibraphon'] },
  { family: 'tubularbells', display: 'Tubular Bells', kind: 'numbered', aliases: ['tubular bells', 'röhrenglocken', 'chimes'] },
  { family: 'windchimes', display: 'Wind Chimes', kind: 'numbered', aliases: ['wind chimes', 'windchimes'] },
  { family: 'bells', display: 'Bells', kind: 'numbered', aliases: ['bells', 'glocken'] },
  { family: 'tinwhistle', display: 'Tin Whistle', kind: 'numbered', aliases: ['tin whistle'] },
  { family: 'bagpipes', display: 'Bagpipes', kind: 'numbered', aliases: ['bagpipes', 'bagpipe', 'dudelsack', 'pipes'] },
  { family: 'snaredrum', display: 'Snare Drum', kind: 'numbered', aliases: ['snare drum', 'snaredrum', 'snare', 'kleine trommel'] },
  { family: 'bassdrum', display: 'Bass Drum', kind: 'numbered', aliases: ['bass drum', 'grosse trommel'] },
  { family: 'mallets', display: 'Mallets', kind: 'numbered', aliases: ['mallets', 'mallet percussion'] },
];

export type Rank = {
  display: string;
  order: number;
  aliases: string[];
  slips?: string[];
  /** Instrument family this rank names on its own: a bare "Soprano" is the soprano cornet. */
  implies?: string;
};

export const RANKS: Rank[] = [
  { display: 'Soprano', order: 0, aliases: ['soprano', 'sopran', 'sop'], implies: 'cornet' },
  { display: 'Solo', order: 1, aliases: ['solo'] },
  { display: 'Repiano', order: 2, aliases: ['repiano', 'ripiano', 'rep'], implies: 'cornet' },
  { display: '1st', order: 3, aliases: ['1st', '1', 'first', 'i', 'ist', 'lst'], slips: ['4st', '1s'] },
  { display: '2nd', order: 4, aliases: ['2nd', '2', 'second', 'ii'], slips: ['znd', '2nc'] },
  { display: '3rd', order: 5, aliases: ['3rd', '3', 'third', 'iii'], slips: ['3rc', 'srd'] },
  { display: '4th', order: 6, aliases: ['4th', '4', 'fourth'] },
];

/** Words that join two ranks ("2nd & 3rd Cornet") or pad a name ("Cornet in Bb"). */
export const FILLER = new Set(['&', '+', 'and', 'und', 'in', 'for', 'für', 'optional', 'opt', 'ad', 'lib']);

/** Names offered as suggestions in the review screen, in score order. */
export const STANDARD_PARTS: string[] = [
  'Soprano Cornet',
  'Solo Cornet',
  'Repiano Cornet',
  '2nd Cornet',
  '3rd Cornet',
  'Flugelhorn',
  'Trumpet',
  'Althorn',
  'Clarinet',
  'Alto Clarinet',
  'Bass Clarinet',
  'Soprano Saxophone',
  'Alto Saxophone',
  'Tenor Saxophone',
  'Saxophone',
  'Solo Horn',
  '1st Horn',
  '2nd Horn',
  '1st Baritone',
  '2nd Baritone',
  '1st Trombone',
  '2nd Trombone',
  'Bass Trombone',
  '1st Euphonium',
  '2nd Euphonium',
  'Eb Bass',
  'Bb Bass',
  'Timpani',
  'Percussion',
  'Percussion 1',
  'Percussion 2',
  'Drum Set',
  'Glockenspiel',
  'Lyra',
  'Congas',
  'Tambourine',
];
