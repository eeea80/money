/**
 * Bounded ring of PTY output bytes, keyed by a monotonic seq.
 *
 * The seq value at any byte is "how many bytes the session has emitted in
 * total since spawn (or since the start of this buffer's history)" up to
 * but not including that byte. It is monotonic and never resets — a client
 * that remembers `lastSeq` across PTY restarts will still correctly request
 * bytes starting at that point; eviction simply means the buffer can no
 * longer satisfy the request fully and the caller has to tell the client
 * "scrollback was truncated past this point".
 *
 * Eviction policy: when `totalBytes` exceeds `maxBytes`, drop bytes from the
 * head (oldest end) — whole chunks at a time, or a partial chunk if needed.
 */

export interface ReplaySlice {
  /** Bytes from `effectiveSeq` (inclusive) up to `tailSeq`. */
  readonly bytes: Buffer;
  /**
   * The seq the returned bytes actually start at. Equals the requested `seq`
   * unless eviction pushed `headSeq` past it; in that case it's `headSeq`
   * and the caller knows `requestedSeq < effectiveSeq` bytes were lost.
   */
  readonly effectiveSeq: number;
  /** seq just past the last byte in `bytes`. Identical to `buffer.tailSeq`. */
  readonly tailSeq: number;
}

export class ReplayBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private head = 0;

  constructor(private readonly maxBytes: number) {
    if (maxBytes <= 0) throw new RangeError('ReplayBuffer maxBytes must be > 0');
  }

  get headSeq(): number {
    return this.head;
  }

  get tailSeq(): number {
    return this.head + this.totalBytes;
  }

  get sizeBytes(): number {
    return this.totalBytes;
  }

  append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    this.evict();
  }

  since(seq: number): ReplaySlice {
    const effectiveSeq = Math.max(seq, this.head);
    const tailSeq = this.tailSeq;
    if (effectiveSeq >= tailSeq) {
      return { bytes: EMPTY, effectiveSeq, tailSeq };
    }
    const skipBytes = effectiveSeq - this.head;
    const out: Buffer[] = [];
    let remainingSkip = skipBytes;
    for (const chunk of this.chunks) {
      if (remainingSkip >= chunk.length) {
        remainingSkip -= chunk.length;
        continue;
      }
      if (remainingSkip > 0) {
        out.push(chunk.subarray(remainingSkip));
        remainingSkip = 0;
      } else {
        out.push(chunk);
      }
    }
    return { bytes: Buffer.concat(out), effectiveSeq, tailSeq };
  }

  private evict(): void {
    while (this.totalBytes > this.maxBytes) {
      const oldest = this.chunks[0];
      if (!oldest) return;
      const overshoot = this.totalBytes - this.maxBytes;
      if (overshoot >= oldest.length) {
        this.chunks.shift();
        this.totalBytes -= oldest.length;
        this.head += oldest.length;
      } else {
        this.chunks[0] = oldest.subarray(overshoot);
        this.totalBytes -= overshoot;
        this.head += overshoot;
      }
    }
  }
}

const EMPTY = Buffer.alloc(0);
