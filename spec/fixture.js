const fs = require("fs");
const path = require("path");
const { ChildProcess } = require("child_process");
const { GitRepository } = require("lumine");

module.exports = function captureFixture() {
  const GitDiffView = require("../lib/git-diff-view");
  const originalEditors = new Set(lumine.workspace.getTextEditors());
  const originalPaths = lumine.project.getPaths();
  const work = [
    spyOn(GitDiffView.prototype, "bindRepository").and.callThrough(),
    spyOn(lumine.repositories, "resolveForPath").and.callThrough(),
    spyOn(GitDiffView.prototype, "updateDiffs").and.callThrough(),
    spyOn(GitRepository.prototype, "repositoryHostRequest").and.callThrough(),
    spyOn(lumine.project, "repositoryForPathFromProviders").and.callThrough(),
    spyOn(lumine.repositories, "scanProjectRoots").and.callThrough(),
  ];
  const completed = work.map(() => 0);
  const settleWork = async () => {
    while (true) {
      const promises = work.flatMap((spy, index) => {
        const calls = spy.calls.all().slice(completed[index]);
        completed[index] += calls.length;
        return calls.map((call) => call.returnValue);
      });
      if (promises.length === 0) return;
      await Promise.allSettled(promises);
    }
  };

  // An aborted blob waiter can finish before the shared loader's Git child
  // closes. Observe the child itself so teardown releases its cwd on Windows.
  const children = [];
  const spawn = ChildProcess.prototype.spawn;
  spyOn(ChildProcess.prototype, "spawn").and.callFake(function (options) {
    const closed = new Promise((resolve) => this.once("close", resolve));
    const result = spawn.call(this, options);
    const cwd = options.cwd || process.cwd();
    let directory = path.resolve(
      ArrayBuffer.isView(cwd)
        ? Buffer.from(cwd.buffer, cwd.byteOffset, cwd.byteLength).toString()
        : cwd,
    );
    try {
      directory = fs.realpathSync.native(directory);
    } catch {
      // Spawn reports a missing cwd itself; its close event still settles.
    }
    children.push({ directory, closed });
    return result;
  });

  return async (repositoryPath) => {
    const directory = fs.realpathSync.native(repositoryPath);
    const ownsDirectory = (candidate) => {
      const relative = path.relative(directory, candidate);
      return (
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      );
    };
    const repository = await lumine.repositories.resolveForPath(repositoryPath, { refresh: false });
    for (const editor of lumine.workspace.getTextEditors()) {
      if (!originalEditors.has(editor)) editor.destroy();
    }
    lumine.project.setPaths(originalPaths);

    await settleWork();
    const owners = lumine.repositories
      .getRepositories()
      .filter((owner) => ownsDirectory(fs.realpathSync.native(owner.getWorkingDirectory())));
    for (const owner of new Set([repository, ...owners])) owner?.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();

    let closedChildren = 0;
    while (true) {
      // Destroy notifications can start another discovery or canceled read.
      await settleWork();
      const pending = children.slice(closedChildren);
      closedChildren += pending.length;
      if (pending.length === 0) return;
      await Promise.all(
        pending.filter((child) => ownsDirectory(child.directory)).map((child) => child.closed),
      );
    }
  };
};
