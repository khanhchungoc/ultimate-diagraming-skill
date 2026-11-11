<#
.SYNOPSIS
    Installs ultimate-diagram into target AI agent runtimes at either User (global) or Project (workspace) level.

.DESCRIPTION
    Supports Antigravity, Claude Code, GitHub Copilot, OpenAI Codex, Gemini CLI, and Kiro.
    Can create directory junctions/symlinks (instant updates during development) or standalone copies.

.PARAMETER Scope
    'User' (global for current user) or 'Project' (current workspace directory). Default is 'User'.

.PARAMETER Runtime
    Target runtime harness: 'antigravity', 'claude', 'copilot', 'codex', 'gemini', 'kiro', or 'all'. Default is 'all'.

.PARAMETER Mode
    'Symlink' (uses NTFS directory junction on Windows without requiring admin) or 'Copy'. Default is 'Symlink'.

.PARAMETER TargetPath
    The workspace root for Project-level installation. Defaults to the current working directory.

.EXAMPLE
    # Install globally for all agents
    .\scripts\install.ps1

    # Install into current project for Antigravity
    .\scripts\install.ps1 -Scope Project -Runtime antigravity

    # Install into Claude Code globally via copy
    .\scripts\install.ps1 -Scope User -Runtime claude -Mode Copy
#>
[CmdletBinding()]
param (
    [ValidateSet("User", "Project")]
    [string]$Scope = "User",

    [ValidateSet("all", "antigravity", "claude", "claude-code", "copilot", "github-copilot", "vscode-copilot", "codex", "gemini", "kiro")]
    [string]$Runtime = "all",

    [ValidateSet("Symlink", "Copy")]
    [string]$Mode = "Symlink",

    [string]$TargetPath = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$lastDest = $repoRoot
$copyExcluded = @(".git", "node_modules", ".github", "agent", ".agents", ".claude", "dev", "bin", "docs", "skills-lock.json", ".gitignore")
$userHome = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)

Write-Host "==> Installing ultimate-diagram" -ForegroundColor Cyan
Write-Host "    Source:  $repoRoot"
Write-Host "    Scope:   $Scope"
Write-Host "    Mode:    $Mode"
Write-Host "    Target:  $($Runtime.ToUpper())"

$destinations = @{}

if ($Scope -eq "User") {
    $destinations["antigravity"] = Join-Path $userHome ".gemini\config\skills\ultimate-diagram"
    $destinations["claude"]      = Join-Path $userHome ".claude\skills\ultimate-diagram"
    $destinations["copilot"]     = Join-Path $userHome ".copilot\skills\ultimate-diagram"
    $destinations["codex"]       = Join-Path $userHome ".agents\skills\ultimate-diagram"
    $destinations["gemini"]      = Join-Path $userHome ".gemini\skills\ultimate-diagram"
    $destinations["kiro"]        = Join-Path $userHome ".kiro\skills\ultimate-diagram"
} else {
    New-Item -ItemType Directory -Path $TargetPath -Force | Out-Null   # like the other installers
    $targetDir = (Resolve-Path $TargetPath).Path
    $destinations["antigravity"] = Join-Path $targetDir ".agents\skills\ultimate-diagram"
    $destinations["claude"]      = Join-Path $targetDir ".claude\skills\ultimate-diagram"
    $destinations["copilot"]     = Join-Path $targetDir ".github\skills\ultimate-diagram"
    $destinations["codex"]       = Join-Path $targetDir ".agents\skills\ultimate-diagram"
    $destinations["gemini"]      = Join-Path $targetDir ".gemini\skills\ultimate-diagram"
    $destinations["kiro"]        = Join-Path $targetDir ".kiro\skills\ultimate-diagram"
}

$normalizedRuntime = switch ($Runtime) {
    "github-copilot" { "copilot" }
    "vscode-copilot" { "copilot" }
    "claude-code"    { "claude" }
    default          { $Runtime }
}
$runtimesToInstall = if ($normalizedRuntime -eq "all") { @("antigravity", "claude", "copilot", "codex", "gemini", "kiro") } else { @($normalizedRuntime) }

foreach ($rt in $runtimesToInstall) {
    $dest = $destinations[$rt]
    $canonicalDest = [System.IO.Path]::GetFullPath($dest).TrimEnd('\', '/')
    $canonicalRepo = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\', '/')

    if ($canonicalDest -eq $canonicalRepo) {
        Write-Host "    Target ($rt) -> $dest is the source repository; skipping to prevent self-deletion." -ForegroundColor Yellow
        continue
    }

    $parentDir = Split-Path $dest -Parent

    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    # Get-Item (not Test-Path) so a junction whose source moved is still found and replaced.
    $item = Get-Item $dest -Force -ErrorAction SilentlyContinue
    if ($item) {
        Write-Host "    Removing existing target at $dest" -ForegroundColor Yellow
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            cmd /c rmdir "$dest" | Out-Null
        } else {
            Remove-Item -Path $dest -Recurse -Force | Out-Null
        }
    }

    $copy = ($Mode -eq "Copy")
    if (-not $copy) {
        Write-Host "    Linking ($rt) -> $dest" -ForegroundColor Green
        # mklink is a native command: it reports failure through the exit code, not an exception.
        cmd /c mklink /J "$dest" "$repoRoot" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Junction creation failed. Falling back to copy..."
            $copy = $true
        }
    }
    if ($copy) {
        Write-Host "    Copying ($rt) -> $dest" -ForegroundColor Green
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Get-ChildItem -Path $repoRoot -Force -Exclude $copyExcluded | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
        }
        Get-ChildItem -Path $dest -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
    }
    $lastDest = $dest
}

Write-Host ""
Write-Host "[SUCCESS] Installed ultimate-diagram." -ForegroundColor Green
Write-Host ""

# Check the installed copy can run: its files, Python 3.9+, a browser, Node.js.
$checkScript = Join-Path $lastDest "scripts\check_env.py"
foreach ($py in @(@("python"), @("py", "-3"), @("python3"))) {
    if (Get-Command $py[0] -ErrorAction SilentlyContinue) {
        $pyArgs = @($py | Select-Object -Skip 1) + $checkScript
        & $py[0] @pyArgs
        if ($LASTEXITCODE -ne 9009) { exit $LASTEXITCODE }   # 9009: Windows Store alias stub, not real Python
    }
}
Write-Host "[MISSING] Python 3.9+ is not on PATH; the skill's scripts need it." -ForegroundColor Red
exit 1
