# DeepSeek Browser Agent — RenderWolf Slots Studio

A bounded **DeepSeek Flash + Playwright** agent built on the authenticated RenderWolf bridge. The agent observes **visible DOM controls** (labels, roles, short text and screen positions) and chooses the next action with DeepSeek tool-calling. This first version uses structured DOM, not screenshot vision. There is no generic shell tool or browser evaluation tool exposed to the model.

**Status:** Unit tests and CI can run without live credentials. Actual RenderWolf export behavior must be verified on your local authenticated PC. RenderWolf terms may prohibit automation; no attempt is made to bypass provider restrictions.

## 1. Add the DeepSeek API key (Windows)

Open PowerShell:

    cd "$HOME\renderwolf-bridge"
    git pull origin feat/renderwolf-export-bridge
    cd .\tools\renderwolf-browser
    Copy-Item .env.example .env.local
    notepad .env.local

Replace the placeholder in the .env.local file with your own DeepSeek key, exactly like:

    DEEPSEEK_API_KEY=sk-your-secret-key

Save the file. Local .env.local is ignored by Git through the .env.* rule. **Never paste your real key into GitHub or a chat**, and never commit the file. The key is loaded locally by Node and used only in the DeepSeek API authorization header. Setting the DEEPSEEK_API_KEY environment variable is also supported.

The model is the currently documented deepseek-flash (non-thinking tool calling), via the official API endpoint https://api.deepseek.com/chat/completions. DeepSeek API usage can cost money; the tool limits steps/tokens and reports usage.

## 2. First task: download EXISTING Yeti animation only

The existing Chrome extension has already exported a local renderwolf-session.json from your regular Chrome. Keep that file **only on your PC**, never on GitHub or in chat. Open PowerShell in the tools/renderwolf-browser directory and run:

    node agent.mjs --task "Télécharge l'animation déjà existante du Yéti en sprite sheet 4x4. Choisis Both sheets (.zip), puis Download. Ne génère, ne régénère et ne modifie rien." --session-file "$HOME\Downloads\renderwolf-session.json" --start-url "https://slots.renderwolf.ai/games/1785165208846/design/character_symbol_set_1785165292435_symbol_1/extra/animation" --output-dir "$HOME\Downloads\renderwolf-yeti-agent-01" --max-steps 12

The output directory must not exist. If repeating a run, use a new folder name. The agent opens a fresh Chromium context with your RenderWolf session, reads the existing animation interface and chooses the next visible control.

If successful, the new directory will contain the downloaded ZIP and an agent-report.json receipt recording file size and SHA-256. The download is the actual success criterion, not a claim by the AI model.

## 3. Guardrails

- One model-requested UI action per iteration; 12 steps default, hard cap 24.
- Total DeepSeek token budget 12,000 default; hard cap 40,000. No automatic retries.
- Up to five exports, up to 256 MiB each; never overwrites existing files.
- Navigation restricted to RenderWolf HTTPS. No generic browser JS or shell access is exposed to DeepSeek.
- Payment, billing, credit purchases, logout, publication and destructive actions are blocked.
- Generation, regeneration and AI editing are **blocked by default**.
- With --allow-generation, at most one generation/modification click is considered, and it requires typing AUTORISER at the terminal. No unattended credit-consuming generations.
- Cookies, browser storage, form values, images, raw HTML and screenshots are **not sent to DeepSeek**.
- Only compact visible UI labels, screen coordinates, and the user's task are sent to DeepSeek; visible text could be sensitive, so use on the dedicated RenderWolf UI only.
- The agent reports incomplete results truthfully; step limit and controls are not proof of successful download.

Watch the first run in Chromium. You can press Ctrl+C to stop. A manual export remains a fallback.

## 4. Architecture

- The existing Chrome extension exports authentication to a local file.
- Node opens an isolated Playwright Chromium context using that file.
- DeepSeek sees structured visible interface controls and suggests one tool call: click, fill, wait, or finish.
- Local validation rejects unsafe actions and invalid target IDs.
- Playwright clicks the chosen control and observes the new state.
- On download, the file is saved and SHA-256 verified. The existing Python renderwolf_bridge.py can then import the asset into the PixiJS studio.

This is a first agent implementation, **not yet a proven live RenderWolf generation/export integration**.

## 5. Tests

From the repository root:

    node --test tools/renderwolf-browser/test-agent.mjs

Or from the browser folder:

    npm test
    node --check agent.mjs

GitHub Actions validates the pure agent logic and source syntax. It does not consume DeepSeek credits or access RenderWolf.

## Troubleshooting

- Missing local .env.local: copy .env.example to .env.local and fill the key.
- HTTP 401: DeepSeek key was rejected.
- HTTP 402: DeepSeek API balance is insufficient.
- Chromium asks for Google: re-export the RenderWolf session from normal Chrome; do not share that file.
- Output directory already exists: choose another directory name.
- No visible browser controls: check that RenderWolf finished loading.
- Generation blocked: this is intentional; first task downloads only the existing Yeti animation.
- If the agent exhausts steps, check its local agent-report.json file for truthful status.

**Account caution:** RenderWolf can restrict automated access in its terms; use at your own risk.
