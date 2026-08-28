################################################
# 一键同步 sop planet 页面到 GitHub Pages 仓库（原 Gitee Pages 已停用，改用 GitHub）
# 远程仓库：https://github.com/NepheLoudy/qianli-sop
# Pages 地址（部署成功后）：https://NepheLoudy.github.io/qianli-sop/
# 用法：
#   1. 本地修改完 qianli_sop_planet.html / three.min.js / OrbitControls.js
#   2. 双击或在 PowerShell 中运行:  .\deploy-sop-site.ps1
#   3. 首次 push 会弹出 GitHub 凭据，用户名填 NepheLoudy，密码填"GitHub Personal Token"
#   4. 推送完成后约 30-90 秒 GitHub Actions 自动部署 Pages 并刷新展示页
################################################
$ErrorActionPreference = "Stop"

# 定位根目录（脚本目录，兼容 -File 调用与双击运行）
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = Split-Path -Parent $PSCommandPath }
if (-not $Root) { $Root = $PWD.Path }
Set-Location $Root
Write-Host "==> Work dir: $Root" -ForegroundColor Cyan

# 源文件 & 目标目录
$Src = @{
    Html      = Join-Path $Root "qianli_sop_planet.html"
    Three     = Join-Path $Root "three.min.js"
    OrbitCtrl = Join-Path $Root "OrbitControls.js"
}
$SiteDir = Join-Path $Root "site-sop-planet"

# 检查源文件是否存在
foreach ($k in $Src.Keys) {
    if (!(Test-Path $Src[$k])) {
        Write-Host "[ERR] 缺少源文件: $($Src[$k])" -ForegroundColor Red
        exit 1
    }
}
if (!(Test-Path (Join-Path $SiteDir ".git"))) {
    Write-Host "[ERR] site-sop-planet 还没初始化 git 仓库，先手动执行一次 init/add/remote" -ForegroundColor Red
    exit 1
}

# 1. 拷贝覆盖
Write-Host "==> Copy source files to site-sop-planet/ ..." -ForegroundColor Cyan
Copy-Item $Src.Html      (Join-Path $SiteDir "index.html")      -Force
Copy-Item $Src.Three     (Join-Path $SiteDir "three.min.js")    -Force
Copy-Item $Src.OrbitCtrl (Join-Path $SiteDir "OrbitControls.js") -Force
Write-Host "    copy OK" -ForegroundColor Green

# 1.5 部署版后处理：剥离"编辑面板"HTML 块（本地源文件保留编辑能力，展示版不暴露后端界面）
$indexHtml = Join-Path $SiteDir "index.html"
$content = [System.IO.File]::ReadAllText($indexHtml)
# 删除从 <!-- 编辑面板 --> 注释到对应 editPanel 容器结束 </div> 的整块（到 <!-- 3D 场景 --> 注释前）
$before = $content.Length
$content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    '(?s)\s*<!-- 编辑面板 -->.*?(?=<!-- 3D 场景 -->)',
    "`r`n"
)
# 保险：把"默认展开编辑面板"那行也去掉（元素已不存在，有 if 保护本就不执行，但顺手清理）
$content = $content -replace 'panel\.classList\.add\(''open''\);', '// (部署版已移除编辑面板)'
# 剥离顶部标题/副标题的编辑权限（部署版锁定为只读文本）
$content = $content -replace 'contenteditable="true"', ''
[System.IO.File]::WriteAllText($indexHtml, $content)
Write-Host "    部署版已剥离编辑面板 HTML + 顶部文本编辑权限（$($before - $content.Length) bytes removed）" -ForegroundColor Green

# 2. Git 提交 + 推送
Set-Location $SiteDir
Write-Host "==> git status:" -ForegroundColor Cyan
git --no-pager status --short
Write-Host "==> git add -A" -ForegroundColor Cyan
git add -A
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$commitMsg = "update site at $ts"
Write-Host "==> git commit: $commitMsg" -ForegroundColor Cyan
git commit -m $commitMsg 2>&1 | ForEach-Object { Write-Host "    $_" }
# commit 即使没有任何改动也继续（可能只是想 push）
Write-Host "==> git push to origin ..." -ForegroundColor Cyan
git push 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] git push 失败（exit=$LASTEXITCODE）。" -ForegroundColor Red
    Write-Host "    常见原因 1) 首次推送没凭据：弹窗填 GitHub 用户名 NepheLoudy，密码填『GitHub Fine-grained/Classic Token』" -ForegroundColor Yellow
    Write-Host "             Classic 令牌生成：https://github.com/settings/tokens （勾选 repo 全部权限即可）" -ForegroundColor Yellow
    Write-Host "             Fine-grained 令牌：https://github.com/settings/tokens?type=beta ，给 qianli-sop 仓库勾 Read and Write access to code 权限" -ForegroundColor Yellow
    Write-Host "    常见原因 2) 没绑定 upstream：在 site-sop-planet 目录运行  git push -u origin main  一次即可" -ForegroundColor Yellow
    exit $LASTEXITCODE
}
Write-Host ""
Write-Host "==> 同步完成！GitHub Actions 会自动构建 Pages，约 30-90 秒后刷新 https://NepheLoudy.github.io/qianli-sop/ 即可看到新版本" -ForegroundColor Green
Set-Location $Root
