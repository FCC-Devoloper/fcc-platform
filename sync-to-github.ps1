param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath
)

$ErrorActionPreference = 'Stop'
$SourcePath = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$RepositoryPath = (Resolve-Path -LiteralPath $RepositoryPath).Path

function Invoke-Git {
    param([string[]]$Arguments)
    & git -C $RepositoryPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $RepositoryPath '.git'))) {
    throw 'RepositoryPath is not a Git clone (the .git folder is missing).'
}

$branch = (& git -C $RepositoryPath branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not read the current Git branch.' }
if ($branch -ne 'fcc/railway-relaunch-prep') {
    throw "Switch to branch fcc/railway-relaunch-prep first. Current branch: $branch"
}

$remote = (& git -C $RepositoryPath remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch '(?i)github\.com[:/]FCC-Devoloper/fcc-platform(?:\.git)?$') {
    throw "The origin remote is not FCC-Devoloper/fcc-platform. Current origin: $remote"
}

$status = @(& git -C $RepositoryPath status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Could not check Git status.' }
if ($status.Count -gt 0) {
    throw 'Working tree is not clean. Commit, stash, or back up local changes before running this script.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path (Split-Path -Parent $RepositoryPath) "fcc-backup-$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

# Preserve local secrets and runtime content outside the repository before replacing tracked files.
$preservePaths = @(
    @{ Relative = '.env'; Backup = '.env' },
    @{ Relative = 'data/fcc_data.json'; Backup = 'data/fcc_data.json' },
    @{ Relative = 'public/uploads'; Backup = 'public/uploads' }
)
foreach ($item in $preservePaths) {
    $source = Join-Path $RepositoryPath $item.Relative
    if (Test-Path -LiteralPath $source) {
        $destination = Join-Path $backupRoot $item.Backup
        $parent = Split-Path -Parent $destination
        if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }
}

Write-Host 'Removing tracked files from the working tree...' -ForegroundColor Cyan
Invoke-Git -Arguments @('rm', '-r', '--ignore-unmatch', '--', '.')

Write-Host 'Copying the refreshed FCC project...' -ForegroundColor Cyan
& robocopy $SourcePath $RepositoryPath /E /R:1 /W:1 /XD '.git' 'node_modules' | Out-Host
$copyCode = $LASTEXITCODE
if ($copyCode -ge 8) { throw "Robocopy failed with exit code $copyCode." }

# Restore local-only data after copying the clean source archive.
foreach ($item in $preservePaths) {
    $saved = Join-Path $backupRoot $item.Backup
    if (Test-Path -LiteralPath $saved) {
        $destination = Join-Path $RepositoryPath $item.Relative
        $parent = Split-Path -Parent $destination
        if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        if ($item.Relative -eq 'public/uploads') {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            & robocopy $saved $destination /E /R:1 /W:1 | Out-Host
            $restoreCode = $LASTEXITCODE
            if ($restoreCode -ge 8) { throw "Could not restore uploads (robocopy exit code $restoreCode)." }
        } else {
            Copy-Item -LiteralPath $saved -Destination $destination -Force
        }
    }
}

Write-Host 'Staging refreshed source; secrets and private data stay local...' -ForegroundColor Cyan
Invoke-Git -Arguments @('add', '--all')

# Guard against accidentally publishing private files.
foreach ($privatePath in @('.env', 'data/fcc_data.json', 'data/fcc_data.json.bak')) {
    & git -C $RepositoryPath check-ignore --quiet -- $privatePath
    if ($LASTEXITCODE -ne 0) { throw "Private path is not ignored by Git: $privatePath" }
}

Write-Host ''
Write-Host 'Prepared changes:' -ForegroundColor Green
& git -C $RepositoryPath status --short
if ($LASTEXITCODE -ne 0) { throw 'Could not display Git status.' }

Write-Host 'Creating a commit and pushing the update branch...' -ForegroundColor Cyan
Invoke-Git -Arguments @('commit', '-m', 'Update FCC platform from refreshed project archive')
Invoke-Git -Arguments @('push', 'origin', $branch)
Write-Host ''
Write-Host "Backup saved outside the repository: $backupRoot" -ForegroundColor Green
Write-Host 'Update branch pushed successfully. The production main branch has not been changed.' -ForegroundColor Green
