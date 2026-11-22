<#
.SYNOPSIS
    Собирает и устанавливает тему VS Code "Mori Gruvbox" из .vsix.

.DESCRIPTION
    Часть 1 из 2 проекта Mori Gruvbox. Ставит расширение с темой оформления,
    которая заменяет цветные акценты Gruvbox на нейтральные (в духе Dark Modern),
    сохраняя подсветку синтаксиса Gruvbox.

    Скрипт:
      1. находит исполняемый файл code (PATH -> типовые пути -> параметр);
      2. пересобирает JSON темы и упаковывает .vsix (если не указан -SkipBuild);
      3. спрашивает подтверждение;
      4. устанавливает расширение через официальный CLI.

    Вторая часть (патч интерфейса Mozg) - отдельный скрипт
    install-mozg-theme.ps1 со своим подтверждением.

.PARAMETER Yes
    Не спрашивать подтверждение (для автоматизации).

.PARAMETER Uninstall
    Удалить ранее установленное расширение.

.PARAMETER CodeCommand
    Путь к code / code-insiders / codium. Укажите, если редактор установлен
    в нестандартное место или их несколько.

.PARAMETER ExtensionsDir
    Каталог расширений (--extensions-dir). Для тестовой установки в изоляции.

.PARAMETER UserDataDir
    Каталог данных пользователя (--user-data-dir). Для изоляции.

.PARAMETER SkipBuild
    Не пересобирать .vsix, взять уже существующий.

.EXAMPLE
    .\install-vscode-theme.ps1

.EXAMPLE
    .\install-vscode-theme.ps1 -Uninstall

.EXAMPLE
    .\install-vscode-theme.ps1 -CodeCommand 'C:\VSCodium\bin\codium.cmd'
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

$ExtensionId = 'eterna1-0blivion.mori-gruvbox'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)   # scripts/ -> корень

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "   $text" -ForegroundColor DarkGray }

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

# Общие аргументы CLI: изоляция нужна только для тестовой установки.
$cliArgs = @()
if ($ExtensionsDir) { $cliArgs += @('--extensions-dir', $ExtensionsDir) }
if ($UserDataDir) { $cliArgs += @('--user-data-dir', $UserDataDir) }

Write-Step 'Mori Gruvbox: тема VS Code'

$code = Resolve-CodeCommand -Explicit $CodeCommand
Write-Info "Редактор: $code"

# --- Удаление ----------------------------------------------------------------
if ($Uninstall) {
    Write-Step 'Удаление темы'
    if (-not $Yes) {
        $answer = Read-Host "Удалить расширение $ExtensionId? [y/N]"
        if ($answer -notmatch '^(y|yes|д|да)$') {
            Write-Host 'Отменено.' -ForegroundColor Yellow
            return
        }
    }
    & $code @cliArgs --uninstall-extension $ExtensionId
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Расширение $ExtensionId удалено."
        Write-Host 'Если тема была активной, VS Code переключится на тему по умолчанию.' -ForegroundColor Yellow
    }
    else {
        Write-Host "   CLI вернул код $LASTEXITCODE (возможно, расширение не было установлено)." -ForegroundColor Yellow
    }
    return
}

# --- Сборка .vsix ------------------------------------------------------------
$version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
$vsix = Join-Path $Root "mori-gruvbox-$version.vsix"

if (-not $SkipBuild) {
    Write-Step 'Сборка темы и упаковка'

    Push-Location $Root
    try {
        node (Join-Path $Root 'scripts\build-theme.mjs') | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Сборка JSON темы завершилась ошибкой.' }

        Write-Info 'Упаковка .vsix (npx @vscode/vsce)...'
        $env:npm_config_yes = 'true'
        & npx --yes '@vscode/vsce' package --no-dependencies --out $vsix | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Упаковка .vsix завершилась ошибкой.' }
    }
    finally {
        Pop-Location
        Remove-Item Env:\npm_config_yes -ErrorAction SilentlyContinue
    }
}
elseif (-not (Test-Path -LiteralPath $vsix)) {
    throw "Файл .vsix не найден: $vsix (запустите без -SkipBuild)"
}

if (-not (Test-Path -LiteralPath $vsix)) { throw "Упаковка не создала файл: $vsix" }
Write-Ok ('.vsix: ' + (Split-Path -Leaf $vsix) + ' (' + [math]::Round((Get-Item $vsix).Length / 1KB, 1) + ' КБ)')

# --- Подтверждение -----------------------------------------------------------
if (-not $Yes) {
    Write-Host ''
    Write-Host 'Будет установлено расширение темы:' -ForegroundColor White
    Write-Host "  $ExtensionId" -ForegroundColor White
    Write-Host 'Текущая тема VS Code НЕ меняется автоматически - её можно выбрать после установки.' -ForegroundColor DarkGray
    $answer = Read-Host 'Продолжить установку? [y/N]'
    if ($answer -notmatch '^(y|yes|д|да)$') {
        Write-Host 'Отменено. Файл .vsix остался в папке проекта.' -ForegroundColor Yellow
        return
    }
}

# --- Установка ---------------------------------------------------------------
Write-Step 'Установка'
& $code @cliArgs --install-extension $vsix --force
if ($LASTEXITCODE -ne 0) { throw "code --install-extension вернул код $LASTEXITCODE" }

Write-Ok "Тема установлена: $ExtensionId"

Write-Host ''
Write-Host 'Дальше:' -ForegroundColor Cyan
Write-Host '  Ctrl+K Ctrl+T -> выберите "Mori Gruvbox Dark Hard"' -ForegroundColor Cyan
Write-Host '  (или запустите scripts/install.ps1, чтобы применить обе части сразу)' -ForegroundColor DarkGray

