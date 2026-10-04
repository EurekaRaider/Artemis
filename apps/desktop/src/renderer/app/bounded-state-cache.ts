// Conservative retained-data estimate for immutable protocol projections.
// Shared subtrees are memoized; changed stream leaves do not rewalk old content.
export class BoundedStateCache<T> extends Map<string, T> {
  private readonly estimates = new WeakMap<object, number>();
  private readonly weights = new Map<string, number>();
  private bytes = 0;
  constructor(
    private readonly onEvict: (id: string) => void,
    private readonly maximumEntries = 8,
    private readonly maximumBytes = 64 * 1024 * 1024,
  ) {
    super();
  }
  private weight(value: unknown): number {
    if (typeof value === "string") return value.length * 2 + 24;
    if (!value || typeof value !== "object") return 8;
    const cached = this.estimates.get(value);
    if (cached !== undefined) return cached;
    this.estimates.set(value, 0);
    let size = 64;
    for (const [key, item] of Object.entries(value)) {
      size += key.length * 2 + 32 + this.weight(item);
      if (size > this.maximumBytes) break;
    }
    this.estimates.set(value, size);
    return size;
  }
  override set(id: string, value: T): this {
    this.delete(id);
    const bytes = this.weight(value);
    if (bytes > this.maximumBytes) {
      this.onEvict(id);
      return this;
    }
    super.set(id, value);
    this.weights.set(id, bytes);
    this.bytes += bytes;
    while (this.size > this.maximumEntries || this.bytes > this.maximumBytes) {
      const oldest = this.keys().next().value!;
      this.delete(oldest);
      this.onEvict(oldest);
    }
    return this;
  }
  override delete(id: string): boolean {
    this.bytes -= this.weights.get(id) ?? 0;
    this.weights.delete(id);
    return super.delete(id);
  }
  override clear(): void {
    super.clear();
    this.weights.clear();
    this.bytes = 0;
  }
  get estimatedBytes(): number {
    return this.bytes;
  }
}
