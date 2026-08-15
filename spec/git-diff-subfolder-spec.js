const path = require("path");
const fs = require("@lumine-code/fs-plus");
const temp = require("@lumine-code/temp").track();
const { stopAllWatchers } = require(
  path.join(lumine.application.getResourcePath(), "src", "path-watcher"),
);

describe("GitDiff when targeting nested repository", () => {
  let editor, editorElement, projectPath;

  beforeEach(async () => {
    spyOn(window, "requestAnimationFrame").and.callFake((fn) => {
      fn();
    });
    spyOn(window, "cancelAnimationFrame").and.callFake((_i) => null);

    projectPath = temp.mkdirSync("git-diff-spec-");

    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), projectPath);
    fs.moveSync(path.join(projectPath, "git.git"), path.join(projectPath, ".git"));

    // The nested repo doesn't need to be managed by the temp module because
    // it's a part of our test environment.
    const nestedPath = path.join(projectPath, "nested-repository");
    // Initialize the repository contents.
    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), nestedPath);
    fs.moveSync(path.join(nestedPath, "git.git"), path.join(nestedPath, ".git"));

    lumine.project.setPaths([projectPath]);

    jasmine.attachToDOM(lumine.workspace.getElement());

    await lumine.workspace.open(path.join(nestedPath, "sample.js"));
    await lumine.packages.activatePackage("git-diff");

    editor = lumine.workspace.getActiveTextEditor();
    editorElement = lumine.views.getView(editor);
  });

  afterEach(async () => {
    await Promise.allSettled(
      lumine.project.getPaths().map((projectPath) => lumine.project.getWatcherPromise(projectPath)),
    );
    await stopAllWatchers();
    temp.cleanup();
  });

  describe("When git-diff targets a file in a nested git-repository", () => {
    /***
     * Non-hack regression prevention for nested repositories. If we know
     * that our project path contains two repositories, we can ensure that
     * git-diff is targeting the correct one by creating an artificial change
     * in the ancestor repository, which is percieved differently within the
     * child. In this case, creating a new file will not generate markers in
     * the ancestor repo, even if there are changes; but changes will be
     * marked within the child repo. So all we have to do is check if
     * markers exist and we know we're targeting the proper repository,
     * If no markers exist, we're targeting an ancestor repo.
     */
    it("uses the innermost repository", async () => {
      editor.insertText("a");
      advanceClock(editor.getBuffer().stoppedChangingDelay);
      // The diff is computed off-thread by the git-host worker; against the
      // ancestor repository the file is untracked and never gains a marker,
      // so waiting for one still discriminates the two repositories.
      await conditionPromise(() => editorElement.querySelectorAll(".git-line-modified").length > 0);
      expect(editorElement.querySelectorAll(".git-line-modified").length).toBe(1);
    });
  });
});
