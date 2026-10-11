# git-diff

Marks lines in the editor gutter that have been added, edited, or deleted since the last commit.

Fork of [pulsar-edit/pulsar](https://github.com/pulsar-edit/pulsar) (`packages/git-diff`).

## Features

- **Gutter markers**: marks added and edited lines with colored line numbers, and deleted lines with a compact horizontal marker.
- **Staging status**: distinguishes staged and unstaged changes with separate shades of each change color.
- **Icon or marker style**: shows colored icons instead of the default line-number and deletion markers.
- **Diff navigation**: moves the cursor to the next or previous diff in the editor.
- **Diff list**: opens a searchable list of all diffs in the current file.
- **Wrap-around**: optionally wraps around to the first or last diff when navigating.
- **Scrollbar markers**: shows the changed lines on the scrollbar and minimap via the marker hub.

## Installation

To install `git-diff` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/git-diff`.

## Commands

Commands available in `lumine-workspace`:

- `git-diff:move-to-next-diff`: move the cursor to the next diff,
- `git-diff:move-to-previous-diff`: move the cursor to the previous diff,
- `git-diff:toggle-diff-list`: toggle the list of diffs in the current file.

## Usage

Unstaged markers show edits made since the staged version of the file, including unsaved edits. Staged markers use muted colors with readable contrast in One Night and One Day. When an unstaged change overlaps or touches a staged block, the unstaged marker takes priority and the staged block's marker is hidden. Navigation and the diff list follow the visible markers, and each list entry identifies its staging status.

## Services

- `marker.layer`: provided to draw the changed lines on the editor's overview maps (scrollbar, minimap).

## Customization

Set separate colors for unstaged and staged additions by adding CSS to your `styles.css`:

```css
:root {
  --syntax-color-added: #98c379;
  --syntax-color-added-staged: color-mix(
    in srgb,
    var(--syntax-color-added) 40%,
    var(--syntax-text-color)
  );
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
