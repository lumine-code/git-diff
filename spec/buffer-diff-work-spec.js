const { Emitter } = require("lumine");
const { BufferDiffWork, acquire } = require("../lib/buffer-diff-work");

describe("shared buffer diff work", () => {
  let buffer, repository, emitter, requests, clock, timers, work;
  const input = { inputs: "head/index", editorPath: "/project/file.txt", statusEntry: null };
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  beforeEach(() => {
    emitter = new Emitter();
    buffer = {
      text: "original",
      getText: jasmine.createSpy("getText").and.callFake(() => buffer.text),
      isDestroyed: () => false,
      onDidChange: (fn) => emitter.on("change", fn),
      onDidDestroy: (fn) => emitter.on("destroy", fn),
    };
    requests = [];
    repository = {
      getLineDiffsAsync: jasmine
        .createSpy("diff")
        .and.callFake(
          (path, text, options) =>
            new Promise((resolve, reject) =>
              requests.push({ path, text, ...options, resolve, reject, startedAt: clock }),
            ),
        ),
    };
    clock = 0;
    timers = new Map();
    work = new BufferDiffWork(buffer, repository, {
      now: () => clock,
      schedule: (fn, delay) => {
        const id = {};
        timers.set(id, { fn, due: clock + delay });
        return id;
      },
      cancel: (id) => timers.delete(id),
    });
  });

  afterEach(() => {
    work.destroy();
    emitter.dispose();
  });

  function edit(text) {
    buffer.text = text;
    emitter.emit("change");
  }
  function tick(ms) {
    clock += ms;
    for (const [id, timer] of [...timers])
      if (timer.due <= clock) {
        timers.delete(id);
        timer.fn();
      }
  }

  it("shares both pending and cached results without copying the buffer again", async () => {
    const first = work.request(input);
    const second = work.request(input);
    expect(second).toBe(first);
    expect(requests.length).toBe(1);
    expect(buffer.getText).toHaveBeenCalledTimes(1);
    requests[0].resolve([]);
    await first;
    await work.request(input);
    expect(requests.length).toBe(1);
    expect(buffer.getText).toHaveBeenCalledTimes(1);
  });

  it("runs only the newest revision after a burst, without cancelling the running diff", async () => {
    const first = work.request(input);
    const pending = [];
    for (let i = 0; i < 50; i++) {
      edit(`edit ${i}`);
      pending.push(work.request(input));
    }
    expect(requests.length).toBe(1);
    expect(buffer.getText).toHaveBeenCalledTimes(1);
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].resolve([]);
    await first;
    await settle();
    expect(requests.length).toBe(2);
    expect(requests[1].text).toBe("edit 49");
    requests[1].resolve([]);
    const results = await Promise.all(pending);
    expect(results.slice(0, -1).every((result) => result === undefined)).toBe(true);
    expect(results.at(-1)).toEqual([]);
  });

  it("keeps expensive comparisons progressing throughout uninterrupted typing", async () => {
    edit("first");
    const first = work.request(input);
    clock = 40;
    requests[0].resolve([]);
    await first;

    const typing = [];
    let completed = 1;
    // Every gap is shorter than the adaptive interval. Keep each comparison
    // expensive too, so a debounce cannot escape by observing a fast result.
    for (let index = 0; index < 32; index++) {
      tick(10);
      edit(`typing ${index}`);
      typing.push(work.request(input));
      if (requests[completed] && clock - requests[completed].startedAt >= 40) {
        requests[completed++].resolve([]);
        await settle();
      }
    }

    expect(requests.length).toBeGreaterThan(3);
    expect(completed).toBeGreaterThan(3);
    expect(buffer.getText.calls.count()).toBe(requests.length);
    expect(requests.slice(1).every(({ text }) => text.startsWith("typing "))).toBe(true);
    // Replacement requests must not fan out concurrent comparisons.
    expect(requests.length - completed).toBeLessThan(2);
    work.destroy();
    for (const request of requests.slice(completed)) request.resolve([]);
    await Promise.all(typing);
  });

  it("resumes immediately after an expensive comparison's interval has elapsed", async () => {
    edit("first");
    const first = work.request(input);
    clock = 40;
    requests[0].resolve([]);
    await first;
    tick(1000);
    edit("after idle");
    const next = work.request(input);
    expect(requests.length).toBe(2);
    expect(timers.size).toBe(0);
    requests[1].resolve([]);
    await next;
  });

  it("does not delay small comparisons", async () => {
    edit("one");
    const first = work.request(input);
    clock = 5;
    requests[0].resolve([]);
    await first;
    edit("two");
    const second = work.request(input);
    expect(requests.length).toBe(2);
    expect(timers.size).toBe(0);
    requests[1].resolve([]);
    await second;
  });

  it("does not reuse a result after a path or Git baseline changes", async () => {
    const first = work.request(input);
    requests[0].resolve([]);
    await first;
    const next = work.request({ ...input, inputs: "new index" });
    expect(requests.length).toBe(2);
    requests[1].resolve([]);
    await next;
    const moved = work.request({ ...input, editorPath: "/project/moved.txt" });
    expect(requests.length).toBe(3);
    requests[2].resolve([]);
    await moved;
  });

  it("only cancels shared work after the last pane releases its lease", async () => {
    const first = acquire(buffer, repository);
    const second = acquire(buffer, repository);
    const result = first.request(input);
    expect(second.request(input)).toBe(result);
    first.dispose();
    expect(requests[0].signal.aborted).toBe(false);
    second.dispose();
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].resolve([]);
    expect(await result).toBeUndefined();
  });

  it("releases queued timers and requests when destroyed", async () => {
    edit("first");
    const first = work.request(input);
    clock = 100;
    requests[0].resolve([]);
    await first;
    edit("pending");
    const pending = work.request(input);
    expect(timers.size).toBe(1);
    work.destroy();
    expect(timers.size).toBe(0);
    expect(await pending).toBeUndefined();
    tick(1000);
    expect(requests.length).toBe(1);
  });

  it("recomputes an invalidated input even if the cancelled worker has not settled", async () => {
    const first = work.request(input);
    work.invalidate();
    const replacement = work.request(input);
    expect(replacement).not.toBe(first);
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].resolve([]);
    expect(await first).toBeUndefined();
    await settle();
    expect(requests.length).toBe(2);
    requests[1].resolve([]);
    expect(await replacement).toEqual([]);
  });

  it("retries failed work instead of caching a failed or empty result", async () => {
    const first = work.request(input);
    const failed = expectAsync(first).toBeRejectedWithError("Git unavailable");
    requests[0].reject(new Error("Git unavailable"));
    await failed;
    const retry = work.request(input);
    expect(requests.length).toBe(2);
    requests[1].resolve([]);
    expect(await retry).toEqual([]);
  });
});
