param(
  [string]$PluginDir = 'dist/margin-link',
  [string]$ObsidianExe = 'D:\SoftWare\Obsidian\Obsidian.exe',
  [string]$HostAsar = 'test-profile/obsidian-1.15.1.asar'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (Get-NetTCPConnection -LocalPort 9238 -State Listen -ErrorAction SilentlyContinue) { throw 'Close the previous isolated navigation window before launching another.' }
$runId = [guid]::NewGuid().ToString('N')
$vaultDir = New-Item -ItemType Directory -Path "test-vault/.v03-desktop/$runId"
$profileDir = New-Item -ItemType Directory -Path "test-profile/v03/$runId"
$pluginPath = New-Item -ItemType Directory -Path "$vaultDir/.obsidian/plugins/margin-link"
foreach ($name in 'manifest.json','main.js','styles.css','LICENSE','THIRD_PARTY_NOTICES.txt') { Copy-Item -LiteralPath (Join-Path $PluginDir $name) -Destination $pluginPath }
if ($HostAsar -ne 'bundled') {
  New-Item -ItemType HardLink -Path (Join-Path $profileDir (Split-Path -Leaf $HostAsar)) -Target (Resolve-Path -LiteralPath $HostAsar) | Out-Null
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8 ($file, $content) { [IO.File]::WriteAllText($file, $content, $utf8) }
Write-Utf8 "$profileDir/obsidian.json" (@{communityPluginWarning=$true;vaults=@{a1b2c3d4e5f60718=@{path=$vaultDir.FullName;ts=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();open=$true}}} | ConvertTo-Json -Depth 5)
Write-Utf8 "$profileDir/a1b2c3d4e5f60718.json" '{"x":20,"y":20,"width":1620,"height":920,"isMaximized":false,"zoom":0}'
Write-Utf8 "$vaultDir/.obsidian/community-plugins.json" '["margin-link"]'
Write-Utf8 "$vaultDir/.obsidian/app.json" '{"readableLineLength":true,"livePreview":true,"showUnsupportedFiles":true}'
Write-Utf8 "$vaultDir/.obsidian/core-plugins.json" '[]'
Write-Utf8 "$pluginPath/data.json" '{"schemaVersion":2,"preferences":{"placementMode":"auto","cardShape":"icon","lines":"always"},"layouts":[]}'
New-Item -ItemType Directory -Path "$vaultDir/Docs" | Out-Null
Write-Utf8 "$vaultDir/Docs/Target.md" "# Target`n`nPlain text <script>void 0</script> ![[image.png]]"
Write-Utf8 "$vaultDir/Target.md" "# Another target"
Write-Utf8 "$vaultDir/example.html" '<p>Attachment</p>'
$sourceText = "# Navigation`n`nFirst [[Docs/Target|first]].`n`nSecond [[Docs/Target|second]].`n`nOther [[Target|other]].`n`nAttachment [[example.html]].`n`nMissing [[Missing]].`n`n"
Write-Utf8 "$vaultDir/Navigation.md" ($sourceText + ("Paragraph for scrolling.`n`n" * 120))
Start-Process -FilePath $ObsidianExe -ArgumentList @("--user-data-dir=`"$profileDir`"", '--remote-debugging-port=9238','--remote-debugging-address=127.0.0.1','--no-first-run') -WindowStyle Hidden
Write-Output "Isolated navigation vault $vaultDir"
