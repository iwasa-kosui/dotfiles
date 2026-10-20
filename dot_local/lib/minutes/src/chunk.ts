export type Chunk = {
  section: string;
  ts: string | null;
  startLine: number;
  endLine: number;
  text: string;
};

type Line = { no: number; text: string };
type Unit = { ts: string | null; lines: Line[] };
type Structural = { kind: "single" | "list" | "transcript"; section: string; ts: string | null };
type Block = { structure: Structural; heading: Line; body: Line[] };

const MIN_CHARS = 800;
const MAX_CHARS = 1500;
const singleSections = new Set(["概要", "決定事項", "次のステップ"]);
const headingRe = /^###\s+(.+?)\s*$/;
const timestampHeadingRe = /^###\s+\(?(\d{1,2}:\d{2}:\d{2})\)?\s*$/;
const bulletRe = /^(?:[-*+]|\d+[.)])\s/;

function classify(line: string): Structural | null {
  const timestamp = timestampHeadingRe.exec(line);
  if (timestamp) return { kind: "transcript", section: "文字起こし", ts: timestamp[1] };
  const heading = headingRe.exec(line);
  if (!heading) return null;
  const name = heading[1].replace(/^\*\*(.*)\*\*$/, "$1");
  if (singleSections.has(name)) return { kind: "single", section: name, ts: null };
  if (name === "詳細") return { kind: "list", section: name, ts: null };
  return null;
}

function unitText(unit: Unit): string {
  return unit.lines.map((line) => line.text).join("\n");
}

function makeUnit(lines: Line[], ts: string | null): Unit | null {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].text.trim() === "") start++;
  while (end > start && lines[end - 1].text.trim() === "") end--;
  if (start === end) return null;
  return { ts, lines: lines.slice(start, end) };
}

function splitUnit(unit: Unit): Unit[] {
  if (unitText(unit).length <= MAX_CHARS) return [unit];
  const pieces: Unit[] = [];
  let current: Line[] = [];
  let length = 0;
  const emit = () => {
    const piece = makeUnit(current, unit.ts);
    if (piece) pieces.push(piece);
    current = [];
    length = 0;
  };
  for (const line of unit.lines) {
    for (let offset = 0; offset === 0 || offset < line.text.length; offset += MAX_CHARS) {
      const part = { no: line.no, text: line.text.slice(offset, offset + MAX_CHARS) };
      if (current.length > 0 && length + part.text.length + 1 > MAX_CHARS) emit();
      current.push(part);
      length += part.text.length + 1;
    }
  }
  emit();
  return pieces;
}

function pack(units: Unit[], section: string): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Unit[] = [];
  let length = 0;
  const emit = () => {
    if (current.length === 0) return;
    const first = current[0];
    const lastLines = current[current.length - 1].lines;
    chunks.push({
      section,
      ts: first.ts,
      startLine: first.lines[0].no,
      endLine: lastLines[lastLines.length - 1].no,
      text: current.map(unitText).join("\n\n"),
    });
    current = [];
    length = 0;
  };
  for (const unit of units.flatMap(splitUnit)) {
    const size = unitText(unit).length;
    if (current.length > 0 && length + size > MAX_CHARS) emit();
    current.push(unit);
    length += size;
    if (length >= MIN_CHARS) emit();
  }
  emit();
  return chunks;
}

function splitParagraphs(lines: Line[]): Unit[] {
  const units: Unit[] = [];
  let current: Line[] = [];
  const flush = () => {
    const unit = makeUnit(current, null);
    if (unit) units.push(unit);
    current = [];
  };
  for (const line of lines) {
    if (line.text.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return units;
}

function splitListItems(lines: Line[]): Unit[] {
  const units: Unit[] = [];
  let current: Line[] = [];
  const flush = () => {
    const unit = makeUnit(current, null);
    if (unit) units.push(unit);
    current = [];
  };
  for (const line of lines) {
    if (bulletRe.test(line.text)) flush();
    current.push(line);
  }
  flush();
  return units;
}

function unitToChunk(unit: Unit, section: string, startLine?: number): Chunk {
  return {
    section,
    ts: unit.ts,
    startLine: startLine ?? unit.lines[0].no,
    endLine: unit.lines[unit.lines.length - 1].no,
    text: unitText(unit),
  };
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const lines = markdown.split("\n");
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close > 0) start = close + 1;
  }

  const blocks: Block[] = [];
  const bodyLines: Line[] = [];
  let current: Block | null = null;
  for (let i = start; i < lines.length; i++) {
    const structure = classify(lines[i]);
    if (structure) {
      current = { structure, heading: { no: i + 1, text: lines[i] }, body: [] };
      blocks.push(current);
      continue;
    }
    const line = { no: i + 1, text: lines[i] };
    bodyLines.push(line);
    current?.body.push(line);
  }

  if (blocks.length === 0) return pack(splitParagraphs(bodyLines), "本文");

  const chunks: Chunk[] = [];
  let run: Unit[] = [];
  const flushRun = () => {
    chunks.push(...pack(run, "文字起こし"));
    run = [];
  };
  for (const block of blocks) {
    const { structure } = block;
    if (structure.kind === "transcript") {
      const unit = makeUnit([block.heading, ...block.body], structure.ts);
      if (unit) run.push(unit);
      continue;
    }
    flushRun();
    if (structure.kind === "single") {
      const unit = makeUnit(block.body, null);
      if (unit) chunks.push(unitToChunk(unit, structure.section, block.heading.no));
    } else {
      for (const unit of splitListItems(block.body)) chunks.push(unitToChunk(unit, structure.section));
    }
  }
  flushRun();
  return chunks;
}
