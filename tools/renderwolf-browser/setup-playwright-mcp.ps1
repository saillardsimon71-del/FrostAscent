# One-time setup: official Microsoft Playwright MCP for RenderWolf.
# Run in WINDOWS PowerShell, not Docker/WSL. This script registers an MCP
# server in your local Windows Codex installation; it never opens RenderWolf
# or triggers a generation, purchase or network interaction with the website.
param(
    [string]$SessionFile = (Join-Path $HOME 'Downloads\renderwolf-session.json'),
    [string]$ServerName = 'renderwolf'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedSession = [System.IO.Path]::GetFullPath($SessionFile)
if (-not (Test-Path -LiteralPath $resolvedSession -PathType Leaf)) {
    throw 'RenderWolf session file not found. Re-export locally; never upload it to GitHub.'
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw 'npx/Node.js not found on Windows. Install Node.js 20+ before continuing.'
}
if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw 'Codex CLI is not installed in WINDOWS PowerShell. Run this setup in a Windows MCP-capable client, not the Docker Builder container. See PLAYWRIGHT_MCP.md for VS Code alternatives.'
}
if ($ServerName -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,49}$') {
    throw 'Invalid MCP server name.'
}

Write-Host 'Registering Microsoft Playwright MCP (official) in Windows Codex.'
Write-Host 'Using an isolated Chromium session initialized from the existing LOCAL RenderWolf auth file.'
Write-Host 'No DeepSeek API key is needed. No RenderWolf generation is launched.'
& codex mcp add $ServerName -- npx -y '@playwright/mcp@latest' '--browser=chrome' '--isolated' '--caps=vision' "--storage-state=$resolvedSession"
if ($LASTEXITCODE -ne 0) {
    throw ('Codex MCP registration failed with exit code ' + $LASTEXITCODE)
}
Write-Host 'MCP registered. Start a NEW Codex session on Windows and verify tools with: codex mcp list'
Write-Host 'You can now request Playwright MCP navigation and screenshot-based inspection in Codex.'
