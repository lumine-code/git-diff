// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view"],
  viewport: { width: 1200, height: 600 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    const git = (args) =>
      require("node:child_process").execFileSync("git", args, {
        cwd: context.project,
        windowsHide: true,
      });
    git(["branch", "smoothing"]);
    git(["branch", "data-validation"]);
    state.editor = await open("Version Control/signal.js");
    state.editor.setText(
      "export function average(samples) {\n  if (samples.length === 0) return 0;\n  return samples.reduce((sum, value) => sum + value, 0) / samples.length;\n}\n\nconst samples = [0.2, 0.8, -0.4, 0.5, 1.0];\nconsole.log(`Mean amplitude: ${average(samples).toFixed(2)}`);\n",
    );
    await state.editor.save();
    await lumine.project.setPaths([fixture("Version Control")]);
    await new Promise((r) => setTimeout(r, 600));
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "See changed lines marked beside their line numbers.",
      timeout: 60000,
      async run(context) {
        const { state } = context;
        {
          state.editor.setCursorBufferPosition([1, 10]);
        }
      },
      ready() {
        return Boolean(
          document.querySelector(".line-number.git-line-added,.line-number.git-line-modified"),
        );
      },
    },
  ],
  async cleanup() {},
};
