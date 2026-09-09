const GitDiffView = require("../lib/git-diff-view");
const fs = require("fs");
const path = require("path");

module.exports = function captureFixture() {
  const originalEditors = new Set(lumine.workspace.getTextEditors());
  const originalPaths = lumine.project.getPaths();
  const discovery = spyOn(GitDiffView.prototype, "subscribeToRepository").and.callThrough();

  return async (repositoryPath) => {
    const repository = await lumine.repositories.resolveForPath(repositoryPath, { refresh: false });
    for (const editor of lumine.workspace.getTextEditors()) {
      if (!originalEditors.has(editor)) editor.destroy();
    }
    lumine.project.setPaths(originalPaths);

    // View destruction invalidates discovery, but its filesystem reads still
    // need to return before the fixture's .git directory can be removed.
    let completed = 0;
    while (completed < discovery.calls.count()) {
      const calls = discovery.calls.all().slice(completed);
      completed += calls.length;
      await Promise.allSettled(calls.map((call) => call.returnValue));
    }
    const directory = fs.realpathSync.native(repositoryPath);
    const owners = lumine.repositories.getRepositories().filter((owner) => {
      const relative = path.relative(
        directory,
        fs.realpathSync.native(owner.getWorkingDirectory()),
      );
      return (
        relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      );
    });
    for (const owner of new Set([repository, ...owners])) owner?.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
  };
};
