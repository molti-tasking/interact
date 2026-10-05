/**
 * Re-orders results that complete out of order.
 *
 * Segments are transcribed in parallel, so a short later phrase can come
 * back before a long earlier one. Each segment reserves a sequence number
 * when it starts recording; results are handed on strictly in that order,
 * and a segment that produced nothing (silence, error, cancelled) is
 * `skip`ped so it doesn't hold up the ones behind it.
 */
export function createOrderedDelivery<T>(deliver: (value: T, seq: number) => void) {
  let nextSeq = 0;
  let nextToDeliver = 0;
  const settled = new Map<number, { value: T } | null>();

  function flush() {
    while (settled.has(nextToDeliver)) {
      const entry = settled.get(nextToDeliver);
      settled.delete(nextToDeliver);
      const seq = nextToDeliver;
      nextToDeliver += 1;
      if (entry) deliver(entry.value, seq);
    }
  }

  return {
    /** Reserve the next position in the output order. */
    reserve(): number {
      return nextSeq++;
    },
    /** Settle a reserved position with a value (delivered in order). */
    resolve(seq: number, value: T) {
      if (seq < nextToDeliver || settled.has(seq)) return;
      settled.set(seq, { value });
      flush();
    },
    /** Settle a reserved position with nothing. */
    skip(seq: number) {
      if (seq < nextToDeliver || settled.has(seq)) return;
      settled.set(seq, null);
      flush();
    },
    /** Positions reserved but not yet delivered or skipped. */
    get pending(): number {
      return nextSeq - nextToDeliver;
    },
  };
}

export type OrderedDelivery<T> = ReturnType<typeof createOrderedDelivery<T>>;
