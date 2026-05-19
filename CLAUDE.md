# Tools

Internal design tools for Ordinary Folk, hosted via GitHub Pages.

## Live URLs

- Landing: https://ordinary-folk.github.io/tools/
- g-gradient-26: https://ordinary-folk.github.io/tools/g-gradient-26/
- soccer-field-3d: https://ordinary-folk.github.io/tools/soccer-field-3d/

## Structure

Each tool lives in its own subfolder with an `index.html` entry point. The root `index.html` is a landing page that links to all tools. All tools are self-contained single HTML files with no build step.

## Adding a new tool

1. Create a new folder at the repo root (lowercase, hyphenated name)
2. Add `<folder>/index.html` with the tool content
3. Add a `<li>` link to the root `index.html` under the "Available" section
4. Commit and push to main; Pages redeploys in 1-2 minutes

## Current tools

- `g-gradient-26/` Three-stop gradient playground with full colour, light mode, and dark mode tiers. Dark mode pipeline simulates AE Hue/Saturation + Brightness/Contrast effects with Classic Color Dodge blending onto a background. State is encoded in URL hash params so configurations are shareable via the "Copy link" button.
- `soccer-field-3d/` Three.js scene of a soccer field at 5:2 ratio (170m x 68m outer, FIFA-spec markings preserved). View presets, lens (FOV) presets, PNG export. Includes an image-overlay plane sized to the field outline with file picker, opacity slider, and clear button, useful for comparing a 5:2 design to pitch geometry.

## Style preferences for this repo

- No em dashes. Use commas, periods, or parentheses instead.
- Bulleted output preferred for explanations.
- Direct and concise. Slack-native tone.
- Single-file HTML tools when possible. No frameworks unless there's a real reason.
- Geist + Geist Mono as the type pairing for consistency across tools.
