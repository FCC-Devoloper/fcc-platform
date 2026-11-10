$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is not installed. Install Git for Windows, then run this script again.'
}

$repoPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'FCC-fcc'
$branch = 'fcc/railway-relaunch-prep'
$remote = 'https://github.com/FCC-Devoloper/fcc-platform.git'

if (-not (Test-Path -LiteralPath (Join-Path $repoPath '.git'))) {
    if (Test-Path -LiteralPath $repoPath) {
        throw "The folder already exists but is not a Git clone: $repoPath. Rename it or remove it, then run again."
    }
    Write-Host 'Downloading the FCC GitHub branch...' -ForegroundColor Cyan
    & git clone -b $branch $remote $repoPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone the FCC GitHub branch. Check your internet and GitHub sign-in.' }
}

$syncScript = Join-Path $PSScriptRoot 'sync-to-github.ps1'
Write-Host 'Preparing and publishing the refreshed FCC source...' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File $syncScript -RepositoryPath $repoPath
if ($LASTEXITCODE -ne 0) { throw 'The FCC sync/push script failed. Send the displayed error before retrying.' }

Write-Host ''
Write-Host 'FCC update has been pushed to the preparation branch.' -ForegroundColor Green
Write-Host 'Production main has not been changed yet.' -ForegroundColor Yellow
