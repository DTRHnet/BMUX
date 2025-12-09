<#
.SYNOPSIS
    BMUX Helper Script for Windows.
    Identifies installed browsers and launches them with the BMUX extension loaded.
#>

$ErrorActionPreference = "Stop"

# ANSI Colors for PowerShell
$ESC = [char]27
$GREEN = "$ESC[32m"
$BLUE = "$ESC[34m"
$RED = "$ESC[31m"
$NC = "$ESC[0m"

Write-Host "${BLUE}=== BMUX Extension Loader ===${NC}"

# Get extension directory (current script location)
$ExtDir = $PSScriptRoot
Write-Host "Extension Directory: ${GREEN}$ExtDir${NC}`n"

# Define potential paths for common browsers
$BrowserPaths = @{
    "Google Chrome" = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    "Microsoft Edge" = @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
    )
    "Mozilla Firefox" = @(
        "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
        "$env:ProgramFiles(x86)\Mozilla Firefox\firefox.exe",
        "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe"
    )
    "Brave" = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles(x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"
    )
}

# Find installed browsers
$InstalledBrowsers = @()

foreach ($Name in $BrowserPaths.Keys) {
    foreach ($Path in $BrowserPaths[$Name]) {
        if (Test-Path $Path) {
            $InstalledBrowsers += [PSCustomObject]@{
                Name = $Name
                Path = $Path
            }
            break # Found one valid path for this browser, move to next browser
        }
    }
}

if ($InstalledBrowsers.Count -eq 0) {
    Write-Error "No supported browsers found in standard install locations."
}

# Interactive Menu
Write-Host "Found the following browsers:"
for ($i = 0; $i -lt $InstalledBrowsers.Count; $i++) {
    Write-Host "  [$($i+1)] $($InstalledBrowsers[$i].Name)" -ForegroundColor Cyan
}

$Selection = Read-Host "`nSelect a browser to launch BMUX (1-$($InstalledBrowsers.Count))"

if ($Selection -match '^\d+$' -and $Selection -ge 1 -and $Selection -le $InstalledBrowsers.Count) {
    $SelectedBrowser = $InstalledBrowsers[$Selection - 1]
    Write-Host "`nLaunching $($SelectedBrowser.Name)..." -ForegroundColor Green
    
    if ($SelectedBrowser.Name -like "*Firefox*") {
        Write-Host "For Firefox, automatic loading of unpacked extensions requires 'web-ext' or manual steps." 
        Write-Host "Opening 'about:debugging'..."
        Start-Process -FilePath $SelectedBrowser.Path -ArgumentList "-new-tab", "about:debugging#/runtime/this-firefox"
        Write-Host "1. Click 'Load Temporary Add-on'"
        Write-Host "2. Select this manifest: $ExtDir\manifest.json"
    }
    else {
        # Chromium Based
        Write-Host "Launching with --load-extension flag."
        Start-Process -FilePath $SelectedBrowser.Path -ArgumentList "--load-extension=`"$ExtDir`""
    }
}
else {
    Write-Warning "Invalid selection."
}
