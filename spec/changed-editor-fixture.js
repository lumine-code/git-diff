const fs = require("@lumine-code/fs-plus");
const temp = require("@lumine-code/fs-temp").track();
const path = require("node:path");
const captureFixture = require("./fixture");

module.exports = async function changedEditorFixture() {
  jasmine.useRealClock();
  jasmine.attachToDOM(lumine.workspace.getElement());
  const settle = captureFixture();
  const directory = temp.mkdirSync("git-diff-command-");
  fs.copySync(path.join(__dirname, "fixtures", "working-dir"), directory);
  fs.moveSync(path.join(directory, "git.git"), path.join(directory, ".git"));
  lumine.project.setPaths([directory]);
  const editor = await lumine.workspace.open(path.join(directory, "sample.js"));
  editor.insertText("changed ");
  try {
    await conditionPromise(() =>
      lumine.commands.canDispatch(editor.getElement(), "git-diff:toggle-diff-list"),
    );
  } catch (error) {
    await settle(directory);
    await temp.cleanup();
    throw error;
  }
  return {
    editor,
    async cleanup() {
      await settle(directory);
      await temp.cleanup();
    },
  };
};
