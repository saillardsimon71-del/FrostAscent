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


## Local session import from your regular Chrome — optional

Google may reject sign-in in the Playwright-controlled Chromium browser. This optional path **does not sign in to Google or retrieve Google cookies**. It exports only the RenderWolf cookies and the localStorage from your active, signed-in RenderWolf page in regular Chrome.

**Security:** Session files contain credentials equivalent to access to your RenderWolf account. Never upload them to GitHub, paste them into chat, or send them to anyone. The bundled extension only has RenderWolf host permissions and contains no network calls. Review its source before installing. Provider terms may prohibit automation; the account can be restricted.

### Setup: Chrome extension on your own PC

1. In regular Chrome (where your Google login already works), open: chrome://extensions/
2. Enable Developer mode, click Load unpacked, select the tools/renderwolf-browser/chrome-extension directory from this repository.
3. Visit https://slots.renderwolf.ai/ and sign in normally with Google.
4. Click the RenderWolf session export extension icon, then Exporter ma session localement.
5. Chrome downloads renderwolf-session.json (usually into Downloads). It contains only RenderWolf-domain cookies and the active RenderWolf site's localStorage. No Google cookies are exported.

### Check the imported session before generating

Run in PowerShell, inside the tools/renderwolf-browser directory:

    node cli.mjs inspect --config selectors.local.json --session-file "$HOME\Downloads\renderwolf-session.json"

Chromium should open on RenderWolf. Verify whether it is authenticated, then return to PowerShell and press Enter to inspect interface controls. This command spends **zero generation credits**.

If Chrome saved the file elsewhere, adjust the file path. The command intentionally validates the imported domains and refuses files containing cookies from Google or other sites.

Once you have real, working selectors and the account appears authenticated, subsequent generate/export/full commands can also accept --session-file. A generation is never triggered without --approve-generation:

    node cli.mjs generate --config selectors.local.json --session-file "$HOME\Downloads\renderwolf-session.json" --prompt-file prompt.txt --approve-generation

Do not combine --session-file and --profile. When a session file is given, the script launches a fresh isolated browser context with RenderWolf-only storageState, rather than using the persistent-profile browser.

### Limitations

- The exporter captures RenderWolf cookies and localStorage only. It does **not** capture IndexedDB, sessionStorage or third-party Google identity data. Some apps use IndexedDB for authentication, so imported cookies can be insufficient.
- Session cookies can expire, be invalidated at logout, or be bound to the original browser. No bypass is attempted.
- No browser account, generation, or RenderWolf UI compatibility has been verified through these unit tests.
- Delete renderwolf-session.json after using it; uninstall the unpacked extension if not needed.
