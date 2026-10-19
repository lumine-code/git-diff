const timers = require("timers");
const { CompositeDisposable } = require("lumine");
const { combineLineDiffs } = require("./line-diffs");

const workByBuffer = new WeakMap();
const SLOW_COMPARISON_MS = 16;
const MAX_QUIET_MS = 200;

// One computation per buffer/repository, independent of how many panes display
// it. Keep one running job and only the newest pending revision. Cancelling a
// view's obsolete result must not restart a synchronous diff in the worker.
class BufferDiffWork {
  constructor(
    buffer,
    repository,
    {
      now = () => performance.now(),
      schedule = timers.setTimeout,
      cancel = timers.clearTimeout,
    } = {},
  ) {
    this.buffer = buffer;
    this.repository = repository;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.revision = 0;
    this.owners = 0;
    this.lastDuration = 0;
    this.lastRequestAt = -Infinity;
    this.subscriptions = new CompositeDisposable(
      buffer.onDidChange(() => {
        this.revision++;
      }),
      buffer.onDidDestroy(() => this.destroy()),
    );
  }

  quietDelay() {
    return this.lastDuration > SLOW_COMPARISON_MS
      ? Math.min(MAX_QUIET_MS, this.lastDuration * 2)
      : 0;
  }

  request({ inputs, editorPath, statusEntry }) {
    if (this.destroyed || this.buffer.isDestroyed()) return Promise.resolve(undefined);
    const key = JSON.stringify([this.revision, editorPath, inputs]);
    if (this.pending?.key === key) return this.pending.promise;
    if (this.active?.key === key && !this.active.controller.signal.aborted)
      return this.active.promise;
    if (this.cached?.key === key) return this.cached.promise;

    const requestedAt = this.now();
    const delay = this.quietDelay();
    const busy = this.active || this.pending || requestedAt - this.lastRequestAt < delay;
    this.pending?.resolve(undefined);
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.pending = {
      key,
      promise,
      resolve,
      reject,
      editorPath,
      statusEntry,
      revision: this.revision,
      requestedAt,
      due: requestedAt + (busy ? delay : 0),
    };
    this.lastRequestAt = requestedAt;
    this.pump();
    return promise;
  }

  pump() {
    if (this.destroyed || this.active || !this.pending) return;
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    const delay = this.pending.due - this.now();
    if (delay > 0) {
      this.timer = this.schedule(() => {
        this.timer = null;
        this.pump();
      }, delay);
      return;
    }
    const task = this.pending;
    this.pending = null;
    if (task.revision !== this.revision || this.buffer.isDestroyed()) {
      task.resolve(undefined);
      return;
    }
    this.active = task;
    task.controller = new AbortController();
    void this.compute(task);
  }

  async compute(task) {
    const started = this.now();
    try {
      // Read and transport text only when work actually starts, never for each
      // replaced pending request or for another pane sharing this buffer.
      const text = this.buffer.getText();
      const options = { signal: task.controller.signal, skipMissingBaseline: true };
      const [unstaged, staged] = await Promise.all([
        this.repository.getLineDiffsAsync(task.editorPath, text, { ...options, base: "index" }),
        task.statusEntry?.staged && task.statusEntry.headBlobOid != null
          ? this.repository.getLineDiffsAsync(task.editorPath, text, { ...options, base: "head" })
          : [],
      ]);
      if (this.destroyed || task.controller.signal.aborted) task.resolve(undefined);
      else {
        const diffs = combineLineDiffs(unstaged ?? [], staged ?? []);
        this.cached = { key: task.key, promise: Promise.resolve(diffs) };
        task.resolve(diffs);
      }
    } catch (error) {
      task.controller.abort();
      task.reject(error);
    } finally {
      // Do not throttle the first edit because of a cold initial blob lookup.
      if (task.revision > 0) this.lastDuration = this.now() - started;
      if (this.active === task) this.active = null;
      if (this.pending) {
        this.pending.due = Math.max(this.pending.due, this.pending.requestedAt + this.quietDelay());
      }
      this.pump();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    this.invalidate();
  }

  invalidate() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    this.pending?.resolve(undefined);
    this.pending = null;
    this.active?.controller.abort();
    this.cached = null;
  }
}

function acquire(buffer, repository) {
  let repositories = workByBuffer.get(buffer);
  if (!repositories) workByBuffer.set(buffer, (repositories = new Map()));
  let work = repositories.get(repository);
  if (!work || work.destroyed)
    repositories.set(repository, (work = new BufferDiffWork(buffer, repository)));
  work.owners++;
  let disposed = false;
  return {
    request: (options) => (disposed ? Promise.resolve(undefined) : work.request(options)),
    invalidate: () => {
      if (!disposed) work.invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--work.owners === 0) {
        work.destroy();
        if (repositories.get(repository) === work) repositories.delete(repository);
        if (!repositories.size) workByBuffer.delete(buffer);
      }
    },
  };
}

module.exports = { acquire, BufferDiffWork };
