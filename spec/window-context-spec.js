describe("git-diff pickers in editor windows", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let fixture;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("git-diff");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("git-diff");
    await lumine.workspace.discardEditorWindows();
    await fixture?.cleanup();
    fixture = null;
  });
  it("keeps simultaneous queries in independent native hosts", async () => {
    const workspace = lumine.workspace;
    fixture = await require("./changed-editor-fixture")();
    const first = fixture.editor;
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor({ buffer: first.getBuffer() });
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    await conditionPromise(() =>
      lumine.commands.canDispatch(second.getElement(), "git-diff:toggle-diff-list"),
    );
    await lumine.commands.dispatch(first.getElement(), "git-diff:toggle-diff-list");
    await lumine.commands.dispatch(second.getElement(), "git-diff:toggle-diff-list");
    const local = workspace
      .getMainWindow()
      .getElement()
      .querySelector(".diff-list-view lumine-input-dialog")
      .getModel();
    const remote = extra
      .getElement()
      .querySelector(".diff-list-view lumine-input-dialog")
      .getModel();
    expect(remote.getElement().ownerDocument).toBe(extra.getDocument());
    await local.setQuery("local");
    await remote.setQuery("remote");
    expect(local.getQuery()).toBe("local");
    expect(remote.getQuery()).toBe("remote");
  });
});
