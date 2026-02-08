// LaTeX log structured parser
// Extracts errors, warnings, and info messages from pdflatex/xelatex output

export type LogLevel = 'error' | 'warning' | 'info';

export interface LogEntry {
  level: LogLevel;
  message: string;
  file?: string;
  line?: number;
  context?: string;
}

const ERROR_RE = /^! (.+)/;
const FILE_LINE_RE = /^(\.\/[^\s:]+):(\d+):\s*(.+)/;
const WARNING_RE = /^(?:LaTeX|Package (\w+)) Warning:\s*(.+)/;
const OVERFULL_RE = /^(Overfull|Underfull) \\[hv]box .+ in paragraph at lines? (\d+)/;
const BADBOX_RE = /^(Overfull|Underfull) \\[hv]box/;
const LINE_REF_RE = /on input line (\d+)/;
const FILE_CONTEXT_RE = /^l\.(\d+)\s+(.*)/;

export function parseLatexLog(raw: string): LogEntry[] {
  if (!raw) return [];

  const lines = raw.split('\n');
  const entries: LogEntry[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Match "! Error message"
    const errMatch = line.match(ERROR_RE);
    if (errMatch) {
      const entry: LogEntry = {
        level: 'error',
        message: errMatch[1],
      };
      // Look ahead for "l.123 context"
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const ctx = lines[j].match(FILE_CONTEXT_RE);
        if (ctx) {
          entry.line = parseInt(ctx[1], 10);
          entry.context = ctx[2];
          break;
        }
      }
      entries.push(entry);
      i++;
      continue;
    }

    // Match "./file.tex:123: message"
    const flMatch = line.match(FILE_LINE_RE);
    if (flMatch) {
      entries.push({
        level: 'error',
        file: flMatch[1].replace(/^\.\//, ''),
        line: parseInt(flMatch[2], 10),
        message: flMatch[3],
      });
      i++;
      continue;
    }

    // Match "LaTeX Warning:" or "Package xxx Warning:"
    const warnMatch = line.match(WARNING_RE);
    if (warnMatch) {
      let msg = warnMatch[2];
      // Warnings can span multiple lines until empty line
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && !lines[j].match(/^[!(\s]/)) {
        msg += ' ' + lines[j].trim();
        j++;
      }
      const entry: LogEntry = {
        level: 'warning',
        message: msg.replace(/\s+/g, ' ').trim(),
      };
      const lineRef = msg.match(LINE_REF_RE);
      if (lineRef) entry.line = parseInt(lineRef[1], 10);
      entries.push(entry);
      i = j;
      continue;
    }

    // Match overfull/underfull box
    const boxMatch = line.match(OVERFULL_RE);
    if (boxMatch) {
      entries.push({
        level: 'warning',
        message: line.trim(),
        line: parseInt(boxMatch[2], 10),
      });
      i++;
      continue;
    }

    const badbox = line.match(BADBOX_RE);
    if (badbox) {
      entries.push({
        level: 'warning',
        message: line.trim(),
      });
      i++;
      continue;
    }

    i++;
  }

  return entries;
}
