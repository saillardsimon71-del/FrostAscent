# RenderWolf browser control: use Microsoft Playwright MCP, not a bespoke AI browser agent

## Why this replaces the DeepSeek/DOM loop

The previous `agent.mjs` inspected short control labels and needed one-off rules for each RenderWolf screen. Trials reached Design → Add Element but then repeatedly failed on UI readiness, popups and unrecognized widgets. More regex patches are not a sustainable way to control an image editor.

**New control plane:** official [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp), connected to a *multimodal* MCP client such as Codex on **Windows**. It offers accessibility snapshots, browser clicks, screenshots and optional vision/coordinate interactions for canvases and poorly labelled controls. Use structured refs first, screenshots for ambiguous or graphical interfaces. This is not OCR, DOM reverse engineering or browser-specific learning.

The original `cli.mjs` export/import flow and verified ZIP receipts remain available. The experimental DeepSeek agent remains in the old branch for reference; **do not extend it for browser exploration**.

## Local one-time setup on Windows

Prerequisites: Node.js 20+, Chromium/Chrome, a Windows Codex CLI or other MCP-capable multimodal client, your existing `renderwolf-session.json` on Windows. **Never commit or upload the session file**: it contains authentication state.

From PowerShell, with the `feat/renderwolf-official-playwright-mcp` branch checked out:

```powershell
cd "$HOME\renderwolf-bridge"
powershell -ExecutionPolicy Bypass -File .\tools\renderwolf-browser\setup-playwright-mcp.ps1
```

The script registers the official Playwright MCP server with the **Windows** Codex client using:

```powershell
codex mcp add renderwolf -- npx -y @playwright/mcp@latest --browser=chrome --isolated --caps=vision "--storage-state=$HOME\Downloads\renderwolf-session.json"
```

The script checks for the actual session path and uses an absolute Windows path. The line above is illustrative; prefer the script. The MCP server uses that state for a fresh isolated browser context, not the real Chrome profile. A `codex mcp list` command can verify registration. A new agent session must be started to see the tools. No live browser run has been made by this GitHub change.

If Windows Codex is not installed, the same official MCP can be configured in VS Code/Cursor/Cline using the server command `npx` and args `-y, @playwright/mcp@latest, --browser=chrome, --isolated, --caps=vision, --storage-state=<absolute WINDOWS path>` according to the particular client's MCP configuration. Prefer the browser-extension mode only if you deliberately want to attach to a current Chrome session.

**Important:** The existing Codex Builder executes in Docker/Linux, not on Windows. Its isolated `CODEX_HOME` cannot automatically use the Windows Playwright server or Windows session path. Do not claim that a GitHub PR can remotely operate the user's local authenticated browser.

## Use: one inspection, then one controlled creation

Start a new Windows MCP-capable multimodal agent session with this task:

> Use the **renderwolf Playwright MCP** tools to open
> `https://slots.renderwolf.ai/games/1785165208846/design`.
> Dismiss the known optional "Upgrade Required" upsell via "Maybe Later" if shown.
> Inspect Design → Add Element. Use accessibility snapshots to interact;
> request a screenshot when the editor/canvas cannot be understood from snapshots.
> Identify actual controls to create an image, attach a reference, start a generation,
> animate an asset, and export it. **Do not create, edit, purchase or generate yet.**
> Stop when you can describe the observed creation steps. Never invent success.
> Do not leave RenderWolf or reveal cookies and credentials.

After the interface is mapped by the agent **within that live session**, the user can issue a production instruction with the Frost Ascent Art Director brief. Keep a clear upper bound of one paid generation until the price and result are checked. Never automatically approve purchases/credit consumption. Export an asset to a private local directory, verify bytes, dimensions, transparency and SHA-256; then perform visual QA in the game separately.

### Why this is more efficient

- The MCP accessibility tree has reusable element refs, rather than a custom collection of 90 visible labels.
- Screenshots can show creation wizards, animations and visually custom controls. Vision-capable AI can reason from those images; textual DeepSeek Flash alone cannot.
- Dialogs and SPA navigation are handled with mature browser tools rather than per-site readiness regexes.
- Once authenticated on Windows, Playwright MCP can reuse the existing storage state.
- No per-website learning scripts or screenshots sent manually into ChatGPT are required.

### Safety and limits

Playwright MCP is a **browser control tool**, not an art generator or an art critic. Image quality depends on RenderWolf, references, and the agent's visual model. Session material must remain local. Screenshots can include private UI data; use the authenticated account only in a trusted MCP client. The documented origin allowlist is not a security boundary. Browser automation may be restricted by the provider's terms; do not bypass such restrictions. This PR is an integration/setup pilot, not evidence of a live successful generation.

References: [Playwright MCP](https://github.com/microsoft/playwright-mcp), [profile & storage](https://playwright.dev/mcp/configuration/user-profile), [vision](https://playwright.dev/mcp/vision-mode), [Codex MCP configuration](https://developers.openai.com/learn/docs-mcp).
