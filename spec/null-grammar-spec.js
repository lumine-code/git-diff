const path = require("node:path");

describe("git-diff with no grammar", () => {
  let editor, main;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.nullGrammar);
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
  });
  afterEach(() => editor?.destroy());

  it("does not create repository observers or diff work and retires them on a switch", () => {
    expect(main.markerLayer.views.has(editor)).toBe(false);
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(grammar);
    const view = main.markerLayer.views.get(editor);
    expect(view).toBeDefined();
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(view.destroyed).toBe(true);
    expect(view.subscriptions.disposed).toBe(true);
    expect(main.markerLayer.views.has(editor)).toBe(false);
    editor.setGrammar(grammar);
    expect(main.markerLayer.views.get(editor)).not.toBe(view);
    expect(main.markerLayer.views.get(editor).destroyed).toBe(false);
  });
});
