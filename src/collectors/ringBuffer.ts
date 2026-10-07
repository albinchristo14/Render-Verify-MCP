export class RingBuffer<T> {
  private entries: { entry: T; sequence: number }[] = [];
  private sequence = 0;
  dropped = 0;
  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('Invalid buffer capacity');
  }
  get cursor(): number {
    return this.sequence;
  }
  push(entry: T): void {
    if (this.entries.length === this.capacity) {
      this.entries.shift();
      this.dropped++;
    }
    this.entries.push({ entry, sequence: ++this.sequence });
  }
  /** Stable sequence identifiers and lifetime coverage, including explicit clearing. */
  snapshot(): { entries: { entry: T; sequence: number }[]; missing: number } {
    return {
      entries: [...this.entries],
      missing: this.sequence - this.entries.length,
    };
  }
  values(): T[] {
    return this.entries.map(({ entry }) => entry);
  }
  since(cursor: number): { records: T[]; dropped: number } {
    const records = this.entries
      .filter((item) => item.sequence > cursor)
      .map(({ entry }) => entry);
    return {
      records,
      dropped: Math.max(0, this.sequence - cursor - records.length),
    };
  }
  clear(): void {
    this.entries = [];
    this.dropped = 0;
  }
  remove(predicate: (entry: T) => boolean): void {
    this.entries = this.entries.filter(({ entry }) => !predicate(entry));
  }
}
