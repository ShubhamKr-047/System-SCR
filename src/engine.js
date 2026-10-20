const aborted = () => new DOMException("Analysis cancelled", "AbortError");

// One UCI search at a time. Each worker is fully initialized before its first job.
export class EngineQueue {
  constructor(createWorker, { timeoutMs = 15000 } = {}) {
    this.createWorker = createWorker;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.cache = new Map();
    this.worker = null;
    this.active = null;
    this.ready = false;
    this.focused = new Set();
  }

  focus(fens) {
    this.focused = new Set(fens);
    this.sort();
  }

  invalidate(fen, time) {
    this.cache.delete(`${fen}|${time}`);
  }

  sort() {
    const rank = job => job.priority + (this.focused.has(job.fen) ? 10 : 0);
    this.queue.sort((a, b) => rank(b) - rank(a));
  }

  evaluate(fen, time, { priority = 0, signal } = {}) {
    if (signal?.aborted) return Promise.reject(aborted());
    const key = `${fen}|${time}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    return new Promise((resolve, reject) => {
      const job = { fen, time, key, priority, signal, resolve, reject, score: 0, pv: "", hasScore: false };
      job.cancel = () => {
        this.queue = this.queue.filter(j => j !== job);
        if (this.active === job) {
          this.active = null;
          this.resetWorker(); // Late messages from the cancelled search cannot reach another job.
        }
        this.settle(job, aborted());
        this.pump();
      };
      signal?.addEventListener("abort", job.cancel, { once: true });
      this.queue.push(job);
      this.sort();
      this.pump();
    });
  }

  settle(job, error, result) {
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.cancel);
    if (error) job.reject(error);
    else job.resolve(result);
  }

  resetWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  fail(error) {
    const job = this.active;
    this.active = null;
    this.resetWorker();
    if (job) this.settle(job, error);
    this.pump();
  }

  clear() {
    const jobs = [this.active, ...this.queue].filter(Boolean);
    this.active = null;
    this.queue = [];
    this.resetWorker();
    this.cache.clear();
    this.focused.clear();
    for (const job of jobs) this.settle(job, aborted());
  }

  pump() {
    if (this.active || !this.queue.length) return;
    this.active = this.queue.shift();
    const job = this.active;
    if (this.cache.has(job.key)) {
      this.active = null;
      this.settle(job, null, this.cache.get(job.key));
      this.pump();
      return;
    }
    job.timer = setTimeout(() => this.fail(new Error("Engine timed out. Retry analysis.")), Math.max(this.timeoutMs, job.time * 10));
    if (!this.worker) {
      try {
        const worker = this.createWorker();
        this.worker = worker;
        worker.addEventListener("message", e => {
          if (this.worker !== worker) return;
          // Some engine builds batch multiple UCI lines into one message.
          for (const line of String(e.data).split(/\r?\n/)) this.onLine(line);
        });
        worker.addEventListener("error", e => {
          if (this.worker === worker) this.fail(new Error(e.message || "Engine worker failed"));
        });
        worker.postMessage("uci");
      } catch (error) {
        this.fail(error);
      }
    } else if (this.ready) this.start();
  }

  start() {
    if (!this.active) return;
    this.worker.postMessage(`position fen ${this.active.fen}`);
    this.worker.postMessage(`go movetime ${this.active.time}`);
  }

  onLine(line) {
    if (line === "uciok") this.worker.postMessage("isready");
    else if (line === "readyok" && !this.ready) {
      this.ready = true;
      this.start();
    } else if (line.startsWith("info ") && this.active) {
      const score = line.match(/\bscore (cp|mate) (-?\d+)/);
      const pv = line.match(/\bpv (.+)$/);
      if (score) {
        const n = Number(score[2]);
        this.active.score = score[1] === "mate"
          ? (n > 0 ? 10 - Math.min(n, 9) * 0.01 : -10 + Math.min(-n, 9) * 0.01)
          : n / 100;
        this.active.hasScore = true;
      }
      if (pv) this.active.pv = pv[1].split(" ").slice(0, 8).join(" ");
    } else if (line.startsWith("bestmove ") && this.active) {
      const job = this.active;
      this.active = null;
      if (!job.hasScore) {
        this.settle(job, new Error("Engine returned no evaluation. Retry analysis."));
      } else {
        const result = { score: job.score, pv: job.pv, bestmove: line.split(/\s+/)[1] || "", moveTime: job.time };
        this.cache.set(job.key, result);
        this.settle(job, null, result);
      }
      this.pump();
    }
  }
}
