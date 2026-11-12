/**
 * The queue that works out answer previews in the background, one per
 * browser tab.
 *
 * Pilot: with 3 at a time in arrival order, 27–44 of 104 answers were
 * clicked before their preview existed and fell back to a second, on-demand
 * LLM call. Now more run at once, the most important question goes first
 * (it's the one shown open), and a click waits for a preview already under
 * way instead of starting another call (`wait`).
 *
 * No React here, so the scheduling can be driven with fake timers (tests,
 * and the evaluation's responsiveness simulation).
 */

export const MAX_CONCURRENT_PREVIEWS = 5;
/** How long a click waits for a preview that is queued or running */
export const PREVIEW_WAIT_MS = 30_000;

interface PreviewTask {
  probeId: string;
  /** Lower runs first: question priority, then newest */
  rank: [number, string];
  run: () => Promise<void>;
}

export interface PreviewTaskMeta {
  probeId: string;
  /** [priority (1 = high), createdAt ISO]: lower priority first, then newest */
  rank: [number, string];
}

function byRank(a: PreviewTask, b: PreviewTask) {
  return a.rank[0] - b.rank[0] || b.rank[1].localeCompare(a.rank[1]);
}

export class PreviewQueue {
  private running = 0;
  private readonly queue: PreviewTask[] = [];
  /** Settles when the question's preview task is done (whatever the outcome) */
  private readonly done = new Map<string, Promise<void>>();

  constructor(private readonly maxConcurrent = MAX_CONCURRENT_PREVIEWS) {}

  /** Queue a preview task; it starts as soon as a slot is free, best rank first. */
  run(task: () => Promise<void>, { probeId, rank }: PreviewTaskMeta): void {
    let settle!: () => void;
    const done = new Promise<void>((resolve) => (settle = resolve));
    this.done.set(probeId, done);
    this.queue.push({
      probeId,
      rank,
      run: () =>
        task().finally(() => {
          // A retry may have registered a newer task meanwhile: keep its entry
          if (this.done.get(probeId) === done) this.done.delete(probeId);
          settle();
        }),
    });
    this.queue.sort(byRank);
    this.next();
  }

  /** Move a queued preview to the front (e.g. the question the creator opened). */
  prioritize(probeId: string): void {
    const task = this.queue.find((t) => t.probeId === probeId);
    if (task) {
      task.rank = [-1, task.rank[1]];
      this.queue.sort(byRank);
    }
  }

  /**
   * Wait (up to `timeoutMs`) for a preview of this question that is queued
   * or running here. True if there was one to wait for.
   */
  async wait(probeId: string, timeoutMs = PREVIEW_WAIT_MS): Promise<boolean> {
    const done = this.done.get(probeId);
    if (!done) return false;
    this.prioritize(probeId);
    await Promise.race([
      done,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return true;
  }

  /** Running and waiting tasks (for tests and the evaluation) */
  get size(): { running: number; queued: number } {
    return { running: this.running, queued: this.queue.length };
  }

  private next() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const { run } = this.queue.shift()!;
      this.running++;
      void run().finally(() => {
        this.running--;
        this.next();
      });
    }
  }
}

/** This tab's queue */
const tabQueue = new PreviewQueue();

export function runPreviewTask(task: () => Promise<void>, meta: PreviewTaskMeta): void {
  tabQueue.run(task, meta);
}

export function prioritizeProbePreview(probeId: string): void {
  tabQueue.prioritize(probeId);
}

export function waitForProbePreview(probeId: string, timeoutMs?: number): Promise<boolean> {
  return tabQueue.wait(probeId, timeoutMs);
}
