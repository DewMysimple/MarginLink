param([string]$ObsidianExe = 'D:\SoftWare\Obsidian\Obsidian.exe')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $projectPath 'test-profile'
$vaultPath = Join-Path $projectPath 'test-vault'
if (-not (Test-Path -LiteralPath $ObsidianExe)) { throw "Obsidian executable not found: $ObsidianExe" }
if (-not (Test-Path -LiteralPath (Join-Path $vaultPath '.obsidian/plugins/margin-link/main.js'))) { throw 'Run npm run build and node scripts/setup-test-vault.mjs first.' }
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
$configPath = Join-Path $profilePath 'obsidian.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  $config = @{vaults=@{a1b2c3d4e5f60718=@{path=$vaultPath;ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();open=$true}}}
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 6), $encoding)
}
Start-Process -FilePath $ObsidianExe -ArgumentList @("--user-data-dir=`"$profilePath`"", '--remote-debugging-port=9223', '--remote-debugging-address=127.0.0.1', '--no-first-run') -WindowStyle Hidden
Write-Output "Isolated test Vault: $vaultPath"
Write-Output 'Debug endpoint: http://127.0.0.1:9223 (development only; close this test instance afterward).'
