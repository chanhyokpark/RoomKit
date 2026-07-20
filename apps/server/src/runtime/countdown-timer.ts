/**
 * Deadline-based countdown: stores an absolute end time and arms a single
 * setTimeout. On fire it re-checks the clock (setTimeout can fire early or
 * drift) and re-arms for the remainder if needed.
 */
export class CountdownTimer {
  private deadline: number | null = null;
  private handle: NodeJS.Timeout | null = null;

  constructor(private readonly onExpire: () => void) {}

  get armed(): boolean {
    return this.deadline !== null;
  }

  get endsAt(): Date | null {
    return this.deadline === null ? null : new Date(this.deadline);
  }

  get remainingMs(): number | null {
    return this.deadline === null ? null : Math.max(0, this.deadline - Date.now());
  }

  arm(remainingMs: number): void {
    this.clear();
    this.deadline = Date.now() + Math.max(0, remainingMs);
    this.schedule();
  }

  /** Stops the countdown; returns the remaining ms (null if not armed). */
  disarm(): number | null {
    const remaining = this.remainingMs;
    this.clear();
    this.deadline = null;
    return remaining;
  }

  private schedule(): void {
    if (this.deadline === null) return;
    const delay = Math.max(0, this.deadline - Date.now());
    this.handle = setTimeout(() => {
      if (this.deadline === null) return;
      if (Date.now() < this.deadline) {
        this.schedule();
        return;
      }
      this.deadline = null;
      this.handle = null;
      this.onExpire();
    }, delay);
  }

  private clear(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}
