export interface JsonlRecord {
  line: number;
  value: unknown;
}
/** UTF-8 decoding belongs to the input stream; this parser bounds individual JSON lines. */
export class JsonlReader {
  private tail = '';
  private line = 0;
  incompleteTail = false;
  constructor(private maxLineLength = 1048576) {}
  private parse(line: string): JsonlRecord[] {
    this.line++;
    if (line.length > this.maxLineLength)
      throw new Error(`JSON line ${this.line} exceeds the size limit`);
    if (!line.trim()) return [];
    try {
      return [{ line: this.line, value: JSON.parse(line) as unknown }];
    } catch {
      throw new Error(`Invalid JSON at line ${this.line}`);
    }
  }
  push(chunk: string): JsonlRecord[] {
    const lines = (this.tail + chunk).split('\n');
    this.tail = lines.pop()!;
    if (this.tail.length > this.maxLineLength)
      throw new Error(`JSON line ${this.line + 1} exceeds the size limit`);
    return lines.flatMap((line) => this.parse(line));
  }
  finish(allowIncompleteTail = false): JsonlRecord[] {
    const tail = this.tail;
    this.tail = '';
    if (!tail.trim()) return [];
    try {
      return this.parse(tail);
    } catch (error) {
      if (!allowIncompleteTail || tail.length > this.maxLineLength) throw error;
      this.incompleteTail = true;
      return [];
    }
  }
}
