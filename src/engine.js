const aborted = () => new DOMException("Analysis cancelled", "AbortError");

function searchKey(fen, time, { position, multiPv = 1, searchMoves = [], nodes } = {}) {
  return `${fen}|${time}` + (position || multiPv !== 1 || searchMoves.length || nodes
    ? `|${JSON.stringify([position, multiPv, [...searchMoves].sort(), nodes])}` : "");
}

function stable(history) {
  const last = history.slice(-3);
  return last.length >= 2 && last.every(line => !line.bound && line.depth >= 12 &&
    line.pv.split(" ")[0] === last[0].pv.split(" ")[0] && line.scoreType === last[0].scoreType &&
    (line.scoreType === "mate" ? Math.sign(line.rawScore) === Math.sign(last[0].rawScore)
      : Math.abs(line.rawScore - last[0].rawScore) <= 35));
}

// One UCI search at a time. Each worker is fully initialized before its first job.
export class EngineQueue {
  constructor(createWorker, { timeoutMs = 15000 } = {}) {
    this.createWorker = createWorker;
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.cache = new Map();
    this.cacheGroups = new Map();
    this.worker = null;
    this.active = null;
    this.ready = false;
    this.focused = new Set();
  }

  focus(fens) {
    this.focused = new Set(fens);
    this.sort();
  }

  invalidate(fen, time, options) {
    const group = searchKey(fen, 0, options);
    for (const key of this.cacheGroups.get(group)?.keys() || []) this.cache.delete(key);
    this.cacheGroups.delete(group);
  }

  cached(fen, time, options) {
    // Only reuse the same history, restrictions, MultiPV and node limit.
    // A stronger completed search can satisfy a smaller time request.
    const group = this.cacheGroups.get(searchKey(fen, 0, options));
    let best;
    for (const result of group?.values() || []) {
      if (result.moveTime >= time && (!best || result.moveTime > best.moveTime)) best = result;
    }
    return best;
  }

  sort() {
    const rank = job => job.priority + (this.focused.has(job.fen) ? 10 : 0);
    this.queue.sort((a, b) => rank(b) - rank(a));
  }

  evaluate(fen, time, { priority = 0, signal, position, multiPv = 1, searchMoves = [], nodes } = {}) {
    if (signal?.aborted) return Promise.reject(aborted());
    const key = searchKey(fen, time, { position, multiPv, searchMoves, nodes });
    const cached = this.cached(fen, time, { position, multiPv, searchMoves, nodes });
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const job = { fen, time, key, priority, signal, position, multiPv, searchMoves, nodes,
        resolve, reject, lines: new Map(), history: [] };
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
    this.cacheGroups.clear();
    this.focused.clear();
    for (const job of jobs) this.settle(job, aborted());
  }

  pump() {
    if (this.active || !this.queue.length) return;
    this.active = this.queue.shift();
    const job = this.active;
    const cached = this.cached(job.fen, job.time, job);
    if (cached) {
      this.active = null;
      this.settle(job, null, cached);
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
    const job = this.active;
    this.worker.postMessage(`setoption name MultiPV value ${job.multiPv}`);
    this.worker.postMessage(job.position
      ? `position fen ${job.position.fen}${job.position.moves.length ? ` moves ${job.position.moves.join(" ")}` : ""}`
      : `position fen ${job.fen}`);
    this.worker.postMessage(`go ${job.nodes ? `nodes ${job.nodes}` : `movetime ${job.time}`}${job.searchMoves.length ? ` searchmoves ${job.searchMoves.join(" ")}` : ""}`);
  }

  onLine(line) {
    if (line === "uciok") {
      this.worker.postMessage("setoption name UCI_ShowWDL value true");
      this.worker.postMessage("isready");
    }
    else if (line === "readyok" && !this.ready) {
      this.ready = true;
      this.start();
    } else if (line.startsWith("info ") && this.active) {
      const score = line.match(/\bscore (cp|mate) (-?\d+)/);
      const pv = line.match(/\bpv (.+)$/);
      if (score && pv) {
        const n = Number(score[2]);
        const depth = Number(line.match(/\bdepth (\d+)/)?.[1] || 0);
        const rank = Number(line.match(/\bmultipv (\d+)/)?.[1] || 1);
        const wdl = line.match(/\bwdl (\d+) (\d+) (\d+)/);
        const info = { scoreType: score[1], rawScore: n, depth,
          nodes: Number(line.match(/\bnodes (\d+)/)?.[1] || 0),
          bound: line.match(/\b(lowerbound|upperbound)\b/)?.[1] || null,
          wdl: wdl ? wdl.slice(1).map(Number) : null,
          pv: pv[1], rank };
        info.score = score[1] === "mate"
          ? (n > 0 ? 10 - Math.min(n, 9) * 0.01 : -10 + Math.min(-n, 9) * 0.01)
          : n / 100;
        // A bounded search line is not a completed evaluation.
        if (!info.bound) {
          this.active.lines.set(`${depth}:${rank}`, info);
          if (rank === 1) {
            this.active.history = this.active.history.filter(previous => previous.depth !== depth);
            this.active.history.push(info);
          }
        }
      }
    } else if (line.startsWith("bestmove ") && this.active) {
      const job = this.active;
      this.active = null;
      const bestmove = line.split(/\s+/)[1] || "";
      const primary = [...job.lines.values()].filter(info => info.rank === 1 && info.pv.split(" ")[0] === bestmove)
        .sort((a, b) => b.depth - a.depth)[0];
      if (!primary) {
        this.settle(job, new Error("Engine returned no evaluation. Retry analysis."));
      } else {
        // All alternatives must belong to the same completed depth.
        const candidates = [...job.lines.values()].filter(info => info.depth === primary.depth)
          .sort((a, b) => a.rank - b.rank).map(info => ({ ...info,
            stable: stable([...job.lines.values()].filter(previous => previous.rank === info.rank)
              .sort((a, b) => a.depth - b.depth)) }));
        const result = { ...primary, bestmove, moveTime: job.time, candidates,
          complete: candidates.length === job.multiPv,
          stable: stable(job.history), history: job.history.slice(-3) };
        this.cache.set(job.key, result);
        const group = searchKey(job.fen, 0, job);
        if (!this.cacheGroups.has(group)) this.cacheGroups.set(group, new Map());
        this.cacheGroups.get(group).set(job.key, result);
        this.settle(job, null, result);
      }
      this.pump();
    }
  }
}
