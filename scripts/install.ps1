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

    [ValidateSet("all", "antigravity", "claude", "claude-code", "copilot", "github-copilot", "codex", "gemini", "kiro")]
    [string]$Runtime = "all",

    [ValidateSet("Symlink", "Copy")]
    [string]$Mode = "Symlink",

    [string]$TargetPath = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
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

    if (Test-Path $dest) {
        Write-Host "    Removing existing target at $dest" -ForegroundColor Yellow
        $item = Get-Item $dest -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            cmd /c rmdir "$dest" | Out-Null
        } else {
            Remove-Item -Path $dest -Recurse -Force | Out-Null
        }
    }

    if ($Mode -eq "Symlink") {
        Write-Host "    Linking ($rt) -> $dest" -ForegroundColor Green
        try {
            cmd /c mklink /J "$dest" "$repoRoot" | Out-Null
        } catch {
            Write-Warning "Junction creation failed. Falling back to copy..."
            Copy-Item -Path "$repoRoot\*" -Destination $dest -Recurse -Force -Exclude ".git", "node_modules", ".github", "dev"
        }
    } else {
        Write-Host "    Copying ($rt) -> $dest" -ForegroundColor Green
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Get-ChildItem -Path $repoRoot -Exclude ".git", "node_modules", ".github", "dev" | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
        }
    }
}

Write-Host ""
Write-Host "[SUCCESS] Successfully installed ultimate-diagram!" -ForegroundColor Green
