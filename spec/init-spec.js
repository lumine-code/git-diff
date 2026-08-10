const path = require("path");
const fs = require("@lumine-code/fs-plus");
const temp = require("@lumine-code/temp").track();

const commands = [
  "git-diff:toggle-diff-list",
  "git-diff:move-to-next-diff",
  "git-diff:move-to-previous-diff",
];

describe("git-diff", () => {
  let editor, element;

  beforeEach(async () => {
    const projectPath = temp.mkdirSync("git-diff-spec-");
    fs.copySync(path.join(__dirname, "fixtures", "working-dir"), projectPath);
    fs.moveSync(path.join(projectPath, "git.git"), path.join(projectPath, ".git"));
    lumine.project.setPaths([projectPath]);

    jasmine.attachToDOM(lumine.workspace.getElement());

    await lumine.workspace.open("sample.js");

    editor = lumine.workspace.getActiveTextEditor();
    element = lumine.views.getView(editor);
  });

  describe("When the module is deactivated", () => {
    it("removes all registered command hooks after deactivation.", async () => {
      await lumine.packages.activatePackage("git-diff");
      await lumine.packages.deactivatePackage("git-diff");
      // NOTE: don't use enable and disable from the Public API.
      expect(lumine.packages.isPackageActive("git-diff")).toBe(false);

      lumine.commands
        .findCommands({ target: element })
        .filter(({ name }) => commands.includes(name))
        .forEach((command) => expect(commands).not.toContain(command.name));
    });
  });
});
