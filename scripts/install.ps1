<#
.SYNOPSIS
    Собирает и устанавливает расширение "Mozg (VS) Code - Theme Extension".

.DESCRIPTION
    Упаковывает расширение в .vsix и ставит его через официальный CLI.
    При запуске расширение само предложит подключить Mozg к активной теме
    (команда "Mozg Theme: Apply Mozg Bridge"). Эта обёртка нужна только для
    установки из исходников; settings.json она не трогает.

.PARAMETER Yes
    Не спрашивать подтверждение.

.PARAMETER Uninstall
    Удалить расширение. Мост Mozg убирается командой
    "Mozg Theme: Revert Mozg Bridge" (до удаления) или:
        node scripts/bridge-cli.js revert

.PARAMETER CodeCommand
    Путь к code / code-insiders / codium.

.PARAMETER ExtensionsDir
    Каталог расширений (--extensions-dir), для тестовой установки в изоляции.

.PARAMETER UserDataDir
    Каталог данных пользователя (--user-data-dir), для изоляции.

.PARAMETER SkipBuild
    Не пересобирать .vsix.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Yes
#>
[CmdletBinding()]
param(
    [switch]$Yes,
    [switch]$Uninstall,
    [string]$CodeCommand,
    [string]$ExtensionsDir,
    [string]$UserDataDir,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Package = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$ExtensionId = "$($Package.publisher).$($Package.name)"

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "   $text" -ForegroundColor DarkGray }

function Confirm-Action([string]$Question) {
    if ($Yes) { return $true }
    return ((Read-Host "$Question [y/N]") -match '^(y|yes|д|да)$')
}

function Resolve-CodeCommand {
    param([string]$Explicit)

    if ($Explicit) {
        if (Test-Path -LiteralPath $Explicit) { return $Explicit }
        $cmd = Get-Command $Explicit -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
        throw "Указанный редактор не найден: $Explicit"
    }

    foreach ($name in 'code', 'code-insiders', 'codium') {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
        (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft VS Code\bin\code.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd'),
        'D:\Programs\VS Code\bin\code.cmd',
        'C:\Program Files\VSCodium\bin\codium.cmd'
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    throw 'Не удалось найти редактор. Укажите путь через -CodeCommand.'
}

# --- Основной сценарий ------------------------------------------------------
Write-Step "$($Package.displayName) $($Package.version)"

$code = Resolve-CodeCommand -Explicit $CodeCommand
Write-Info "Редактор: $code"

$cliArgs = @()
if ($ExtensionsDir) { $cliArgs += @('--extensions-dir', $ExtensionsDir) }
if ($UserDataDir) { $cliArgs += @('--user-data-dir', $UserDataDir) }

if ($Uninstall) {
    if (-not (Confirm-Action "Удалить расширение $ExtensionId?")) { Write-Host 'Отменено.' -ForegroundColor Yellow; return }
    & $code @cliArgs --uninstall-extension $ExtensionId
    if ($LASTEXITCODE -ne 0) { throw "code --uninstall-extension вернул код $LASTEXITCODE" }
    Write-Ok 'Расширение удалено.'
    Write-Host '   Мост Mozg убирается командой "Mozg Theme: Revert Mozg Bridge" или:' -ForegroundColor DarkGray
    Write-Host '   node scripts/bridge-cli.js revert' -ForegroundColor DarkGray
    return
}

$vsix = Join-Path $Root "$($Package.name)-$($Package.version).vsix"

if (-not $SkipBuild) {
    Write-Step 'Упаковка'
    Push-Location $Root
    try {
        & npx --yes '@vscode/vsce' package --no-dependencies --out $vsix
        if ($LASTEXITCODE -ne 0) { throw 'Упаковка .vsix завершилась ошибкой.' }
    }
    finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $vsix)) { throw "Файл .vsix не найден: $vsix" }

if (-not (Confirm-Action "Установить $ExtensionId ($((Split-Path -Leaf $vsix)))?")) {
    Write-Host 'Отменено. Файл .vsix остался в папке проекта.' -ForegroundColor Yellow
    return
}

Write-Step 'Установка'
& $code @cliArgs --install-extension $vsix --force
if ($LASTEXITCODE -ne 0) { throw "code --install-extension вернул код $LASTEXITCODE" }
Write-Ok "Установлено: $ExtensionId"

Write-Host ''
Write-Host 'Дальше: перезагрузите окно (Ctrl+Shift+R). Расширение предложит подключить Mozg' -ForegroundColor Cyan
Write-Host 'к активной теме VS Code.' -ForegroundColor Cyan
