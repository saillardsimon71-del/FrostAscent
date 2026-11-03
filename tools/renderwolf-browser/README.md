# RenderWolf Slots Studio — interactive Chromium connector

This is a local, opt-in Playwright tool for generating one asset at a time and downloading its export to the existing RenderWolf → PixiJS import bridge.

**Status:** Browser automation implementation with **configurable selectors**. No RenderWolf account UI or live generation has been tested. The provider's terms currently prohibit automated access, which can lead to account restrictions. Do not use without assessing that risk. It does not bypass CAPTCHA, authentication, rate limits, bot detection or paid feature restrictions.

**Never commit your browser user profile, session files, downloaded private artwork, prompts or API credentials.**

## Setup (separate from active Frost Ascent worktree)

- Work on this GitHub branch in an independent checkout on your own computer.
- Node.js 20+ and a desktop environment capable of showing Chromium are required.
- Install only local dependencies:

    cd tools/renderwolf-browser
    npm install
    npx playwright install chromium

- Copy selectors.example.json to selectors.local.json (do not commit local config).
- Start discovery:

    node cli.mjs inspect --config selectors.local.json

- The program opens a persistent Chromium window. Sign in **manually** and navigate to the Slots Studio interface. Press Enter in the terminal. The program lists the visible input/button labels and placeholders (not entered values). Examine the actual interface and populate your local selector config.

## Controlled run

Once selectors have been verified with your specific authenticated UI, prepare a plain-text prompt file and use:

    node cli.mjs generate --config selectors.local.json --prompt-file prompt.txt --approve-generation

The explicit flag is mandatory; this clicks Generate once, without retries. If ready selector is configured, the program waits for it. Otherwise, inspect the browser and press Enter after completion. On failure, it stops rather than retrying and consuming more credits.

If a working ZIP export selector is configured:

    node cli.mjs export --config selectors.local.json --output-dir /tmp/renderwolf-export-01

To perform both generation and export:

    node cli.mjs full --config selectors.local.json --prompt-file prompt.txt --approve-generation --output-dir /tmp/renderwolf-export-02

The export directory must not exist before running. A receipt containing the download SHA-256 is saved beside the artifact, not in your GitHub checkout. It can then be passed to tools/renderwolf_bridge.py from the parent repo for asset cataloguing.

**Do not assume Generate or Export are a single button.** Real selectors and the actual workflows must be inspected. The automated flow currently supports only a prompt field, one Generate control, optional completion indicator, and optional export menu and download action. Multi-step workflows require scoped extensions after seeing the legitimate UI.

## Controls

- Persistent browser data lives under ~/.local/share/renderwolf-slots-studio-browser with private directory permissions.
- Only RenderWolf HTTPS startup URLs are permitted by default.
- No password in configuration; browser login is manual.
- Single generation click per invocation; no automatic retries.
- No concurrency, background loops, or queue polling.
- No bypass of access-control challenges.
- Do not operate in the same Builder worktree as ART 06.

## Tests

    node --test tools/renderwolf-browser/test-core.mjs

These tests check configuration, guardrails, safety and CLI options, not RenderWolf UI compatibility.
