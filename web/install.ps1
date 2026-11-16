# Installs the latest Crooli MC Launcher on Windows: downloads the installer from GitHub, checks it, and runs it.
#   irm https://mclauncher.crooli.com/install.ps1 | iex
# Read it first if you like: https://mclauncher.crooli.com/install.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host 'Finding the latest version...' -ForegroundColor White
$release = Invoke-RestMethod 'https://api.github.com/repos/xandertaylorx/crooli-mc-launcher/releases/latest' -Headers @{ 'User-Agent' = 'crooli-installer' }
$asset = $release.assets | Where-Object { $_.name -like '*Setup*.exe' } | Select-Object -First 1
if (-not $asset) { throw "Couldn't find the Windows installer in the latest release." }

$file = Join-Path $env:TEMP $asset.name
Write-Host "Downloading Crooli MC Launcher $($release.tag_name.TrimStart('v'))..." -ForegroundColor White
Invoke-WebRequest $asset.browser_download_url -OutFile $file

if ($asset.digest -like 'sha256:*') {
  $want = $asset.digest.Substring(7)
  $got = (Get-FileHash $file -Algorithm SHA256).Hash
  if ($got -ne $want) { Remove-Item $file -Force; throw "The download doesn't match its checksum, so it was not installed." }
}

# Files fetched this way carry no "downloaded from the internet" mark, so SmartScreen doesn't stop the installer.
Unblock-File $file
Write-Host 'Installing...' -ForegroundColor White
Start-Process $file -Wait
Remove-Item $file -Force -ErrorAction SilentlyContinue
Write-Host 'Done. Crooli MC Launcher is in your Start menu.' -ForegroundColor White
