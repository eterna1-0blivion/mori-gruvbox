<#
.SYNOPSIS
    Собирает и устанавливает расширение Mori Gruvbox в VS Code.

.DESCRIPTION
    Упаковывает расширение в .vsix и ставит его через официальный CLI.
    Само расширение при запуске предложит подключить Mozg к активной теме
    (команда "Mori Gruvbox: Apply Mozg Bridge"), поэтому отдельный патч
    больше не нужен. Эта обёртка нужна только для установки из исходников.

    settings.json не меняется. Активной тема становится только при -SetActive.

.PARAMETER Yes
    Не спрашивать подтверждение.

.PARAMETER Uninstall
    Удалить расширение. Мост Mozg убирается командой
    "Mori Gruvbox: Revert Mozg Bridge" (до удаления) или:
        node scripts/bridge-cli.js revert

.PARAMETER SetActive
    После установки сделать тему "Mori Gruvbox" активной (правит
    workbench.colorTheme; бэкап settings.json.bak-mori-gruvbox).

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
    .\install.ps1 -Yes -SetActive
#>
[CmdletBinding()]
param(
    [switch]$Yes,
    [switch]$Uninstall,
    [switch]$SetActive,
    [string]$CodeCommand,
    [string]$ExtensionsDir,
    [string]$UserDataDir,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Package = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$ExtensionId = "$($Package.publisher).$($Package.name)"
$ThemeName = 'Mori Gruvbox'

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

function Set-ActiveTheme([string]$Name) {
    $settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        Write-Host "   settings.json не найден: $settingsPath" -ForegroundColor Yellow
        return
    }

    $raw = [System.IO.File]::ReadAllText($settingsPath)
    $pattern = '"workbench\.colorTheme"\s*:\s*"[^"]*"'
    $replacement = '"workbench.colorTheme": "' + $Name + '"'

    if ([regex]::IsMatch($raw, $pattern)) {
        $updated = [regex]::Replace($raw, $pattern, $replacement, 1)
    }
    else {
        $open = $raw.IndexOf('{')
        if ($open -lt 0) { throw 'Некорректный settings.json: нет открывающей скобки.' }
        $updated = $raw.Insert($open + 1, "`n    " + $replacement + ',')
    }

    # settings.json может содержать комментарии (JSONC). Windows PowerShell 5.1
    # их не разбирает, поэтому корректность результата проверяет Node.
    $check = 'try{new Function("return ("+require("fs").readFileSync(0,"utf8")+")")();process.exit(0)}catch(e){process.exit(1)}'
    $updated | & node -e $check
    if ($LASTEXITCODE -ne 0) { throw 'Правка settings.json дала бы некорректный файл - изменения не применены.' }

    [System.IO.File]::WriteAllText("$settingsPath.bak-mori-gruvbox", $raw, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($settingsPath, $updated, [System.Text.UTF8Encoding]::new($false))
    Write-Ok "Активная тема: $Name (бэкап: settings.json.bak-mori-gruvbox)"
}

# --- Основной сценарий ------------------------------------------------------
Write-Step "Mori Gruvbox $($Package.version)"

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
    Write-Host '   Мост Mozg убирается командой "Mori Gruvbox: Revert Mozg Bridge" или:' -ForegroundColor DarkGray
    Write-Host '   node scripts/bridge-cli.js revert' -ForegroundColor DarkGray
    return
}

$vsix = Join-Path $Root "mori-gruvbox-$($Package.version).vsix"

if (-not $SkipBuild) {
    Write-Step 'Сборка'
    Push-Location $Root
    try {
        & node 'scripts/build-theme.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'Сборка темы завершилась ошибкой.' }
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

if ($SetActive -and (Confirm-Action "Сделать тему '$ThemeName' активной?")) {
    Set-ActiveTheme -Name $ThemeName
}

Write-Host ''
Write-Host 'Дальше: перезагрузите окно (Ctrl+Shift+R). Расширение предложит подключить Mozg' -ForegroundColor Cyan
Write-Host 'к активной теме. Выбрать тему: Ctrl+K Ctrl+T -> "Mori Gruvbox".' -ForegroundColor Cyan

