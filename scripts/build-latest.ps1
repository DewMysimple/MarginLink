#requires -Version 5.1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

# Load the whole workflow before pulling: Git may update this script on disk.
function Invoke-BuildLatest {
    function Invoke-Checked {
        param([string]$FilePath, [string[]]$Arguments)
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed (exit $LASTEXITCODE): $FilePath $($Arguments -join ' ')"
        }
    }

    $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    Set-Location -LiteralPath $projectRoot
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.git'))) {
        throw '请在完整的 Git 项目中运行 buildStart.cmd，不要单独移动此文件。'
    }

    $gitPath = (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $null = Get-Command node.exe -CommandType Application -ErrorAction Stop
    $npmPath = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

    $branch = (Invoke-Checked -FilePath $gitPath -Arguments @('symbolic-ref', '--quiet', '--short', 'HEAD')).Trim()
    if ($branch -ne 'main') {
        throw "当前分支是 $branch。请先切换到 main，再运行此脚本。"
    }
    $changes = Invoke-Checked -FilePath $gitPath -Arguments @('status', '--porcelain', '--untracked-files=no')
    if ($changes) {
        throw '项目有未提交的修改。请先提交或暂存修改，再运行此脚本。'
    }

    Write-Host '[1/3] 拉取 origin/main 最新代码……'
    Invoke-Checked -FilePath $gitPath -Arguments @('pull', '--ff-only', 'origin', 'main')
    $localCommit = (Invoke-Checked -FilePath $gitPath -Arguments @('rev-parse', 'HEAD')).Trim()
    $remoteCommit = (Invoke-Checked -FilePath $gitPath -Arguments @('rev-parse', 'refs/remotes/origin/main')).Trim()
    if ($localCommit -ne $remoteCommit) {
        throw '本地 main 含有远程没有的提交。请先同步这些提交，再构建远程最新版本。'
    }

    Write-Host '[2/3] 按锁文件安装依赖……'
    # npm 12 permits the lockfile's existing mirror URLs for this command only.
    # Integrity hashes are still checked; no global npm configuration is changed.
    Invoke-Checked -FilePath $npmPath -Arguments @('ci', '--allow-remote=all')

    Write-Host '[3/3] 编译、校验并刷新安装目录和 ZIP……'
    Invoke-Checked -FilePath $npmPath -Arguments @('run', 'package')

    $manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $pluginVersion = [string]$manifest.version
    $pluginDirectory = Join-Path $projectRoot 'dist\margin-link'
    $zipPath = Join-Path $projectRoot "dist\margin-link-$pluginVersion.zip"
    $completedAt = Get-Date

    Write-Host ''
    Write-Host "构建成功：$zipPath" -ForegroundColor Green
    Write-Host "安装目录：$pluginDirectory" -ForegroundColor Green
    Write-Host "插件版本：$pluginVersion"
    Write-Host "生成时间：$($completedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
    Write-Host "源码提交：$localCommit"
}

try {
    Invoke-BuildLatest
    exit 0
} catch {
    [Console]::Error.WriteLine("构建失败：$($_.Exception.Message)")
    [Console]::Error.WriteLine('已停止后续步骤；已有压缩包可能是旧版本，请勿当作本次构建结果。')
    exit 1
}
