<#
.SYNOPSIS
    Применяет нейтральную тему Mori Gruvbox к интерфейсу расширения Mozg
    (mori-ai.mori-code) и умеет отменять её.

.DESCRIPTION
    Часть 2 из 2 проекта Mori Gruvbox.

    Расширение Mozg рисует интерфейс в webview и НЕ наследует тему VS Code:
    в webview-ui/build/assets/index.css оно объявляет свои переменные --mori-*
    (акцент #ff6a1a) и через них переопределяет --vscode-*.

    Скрипт дописывает в конец index.css блок переопределений из
    mozg/mori-neutral.css. Блок ограничен маркерами, поэтому:

      - повторный запуск заменяет блок, а не дублирует его;
      - после обновления Mozg (файл придёт чистым) скрипт просто патчит
        новую версию - отката к старой не произойдёт.

    Правка файлов расширения не проверяется VS Code по контрольной сумме,
    поэтому патч безопасен и не ломает загрузку.

.PARAMETER Status
    Только показать состояние: применён патч или нет.

.PARAMETER Revert
    Восстановить оригинальный index.css из index.css.orig.

.PARAMETER Yes
    Не спрашивать подтверждение (для автоматизации).

.PARAMETER ThemeFile
    CSS-файл с блоком переопределений.
    По умолчанию: mozg/mori-neutral.css рядом с проектом.

.PARAMETER ExtensionsRoot
    Каталог расширений VS Code.
    По умолчанию: %USERPROFILE%\.vscode\extensions

.EXAMPLE
    .\install-mozg-theme.ps1

.EXAMPLE
    .\install-mozg-theme.ps1 -Status

.EXAMPLE
    .\install-mozg-theme.ps1 -Revert
#>
[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Revert,
    [switch]$Yes,
    [string]$ThemeFile,
    [string]$ExtensionsRoot
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)   # scripts/ -> корень

if ([string]::IsNullOrWhiteSpace($ThemeFile)) {
    $ThemeFile = Join-Path $Root 'mozg\mori-neutral.css'
}
if ([string]::IsNullOrWhiteSpace($ExtensionsRoot)) {
    $ExtensionsRoot = Join-Path $HOME '.vscode\extensions'
}

$BeginMarker = '/* ===== MORI NEUTRAL THEME BEGIN'
$EndMarker = '/* ===== MORI NEUTRAL THEME END ===== */'

# Признак того, что CSS действительно принадлежит Mozg: если его нет,
# структура изменилась и патчить файл нельзя.
$SignatureMarker = '--mori-accent'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "   $text" -ForegroundColor DarkGray }
function Write-Warn($text) { Write-Host "   $text" -ForegroundColor Yellow }

# --- Проверки ----------------------------------------------------------------
if (-not (Test-Path -LiteralPath $ExtensionsRoot)) {
    throw "Каталог расширений не найден: $ExtensionsRoot"
}

$extensionDirs = @(
    Get-ChildItem -LiteralPath $ExtensionsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'mori-ai.mori-code-*' } |
        Sort-Object Name
)

if ($extensionDirs.Count -eq 0) {
    throw "Расширение mori-ai.mori-code не найдено в $ExtensionsRoot`nУстановите Mozg и повторите."
}

$block = $null
if (-not $Revert -and -not $Status) {
    if (-not (Test-Path -LiteralPath $ThemeFile)) {
        throw "Файл темы не найден: $ThemeFile"
    }
    $block = (Get-Content -LiteralPath $ThemeFile -Raw).TrimEnd()
    if (-not $block.StartsWith($BeginMarker) -or -not $block.EndsWith($EndMarker)) {
        throw "Файл темы повреждён: ожидались маркеры '$BeginMarker' ... '$EndMarker'."
    }
}

Write-Step 'Mori Gruvbox: тема интерфейса Mozg'
Write-Info "Найдено расширений: $($extensionDirs.Count)"
foreach ($dir in $extensionDirs) { Write-Info "  $($dir.Name)" }

# --- Статус ------------------------------------------------------------------
if ($Status) {
    foreach ($dir in $extensionDirs) {
        $cssPath = Join-Path $dir.FullName 'webview-ui\build\assets\index.css'
        $origPath = "$cssPath.orig"

        if (-not (Test-Path -LiteralPath $cssPath)) {
            Write-Warn "[$($dir.Name)] index.css не найден."
            continue
        }

        $css = [System.IO.File]::ReadAllText($cssPath)
        $applied = $css.Contains($BeginMarker)
        $hasBackup = Test-Path -LiteralPath $origPath

        if ($applied) {
            Write-Ok "[$($dir.Name)] патч ПРИМЕНЁН (бэкап: $(if ($hasBackup) { 'есть' } else { 'нет' }))"
        }
        else {
            Write-Warn "[$($dir.Name)] патч НЕ применён"
        }
    }
    return
}

# --- Откат -------------------------------------------------------------------
if ($Revert) {
    Write-Step 'Откат'
    if (-not $Yes) {
        $answer = Read-Host 'Восстановить оригинальный index.css расширения Mozg? [y/N]'
        if ($answer -notmatch '^(y|yes|д|да)$') {
            Write-Host 'Отменено.' -ForegroundColor Yellow
            return
        }
    }

    $done = 0
    foreach ($dir in $extensionDirs) {
        $cssPath = Join-Path $dir.FullName 'webview-ui\build\assets\index.css'
        $origPath = "$cssPath.orig"

        if (-not (Test-Path -LiteralPath $origPath)) {
            Write-Warn "[$($dir.Name)] бэкап отсутствует - откатывать нечего."
            continue
        }

        Copy-Item -LiteralPath $origPath -Destination $cssPath -Force
        Write-Ok "[$($dir.Name)] оригинал восстановлен."
        $done += 1
    }

    if ($done -gt 0) {
        Write-Host ''
        Write-Host 'Перезагрузите окно: Ctrl+Shift+R' -ForegroundColor Cyan
    }
    return
}

# --- Подтверждение -----------------------------------------------------------
if (-not $Yes) {
    Write-Host ''
    Write-Host 'Будет изменён файл внутри установленного расширения Mozg:' -ForegroundColor White
    Write-Host '  webview-ui\build\assets\index.css  (+ блок Mori Gruvbox)' -ForegroundColor White
    Write-Host 'Оригинал сохранится рядом как index.css.orig (откат: -Revert).' -ForegroundColor DarkGray
    Write-Host 'После обновления Mozg патч нужно применить снова.' -ForegroundColor DarkGray
    $answer = Read-Host 'Продолжить? [y/N]'
    if ($answer -notmatch '^(y|yes|д|да)$') {
        Write-Host 'Отменено.' -ForegroundColor Yellow
        return
    }
}

# --- Применение --------------------------------------------------------------
Write-Step 'Применение'

$appliedCount = 0
foreach ($dir in $extensionDirs) {
    $cssPath = Join-Path $dir.FullName 'webview-ui\build\assets\index.css'

    if (-not (Test-Path -LiteralPath $cssPath)) {
        Write-Warn "[$($dir.Name)] index.css не найден - пропуск."
        continue
    }

    $css = [System.IO.File]::ReadAllText($cssPath)

    # Проверка сигнатуры: структура CSS должна остаться прежней.
    if (-not $css.Contains($SignatureMarker)) {
        Write-Warn "[$($dir.Name)] в index.css нет '$SignatureMarker' - похоже, Mozg сменил структуру."
        Write-Warn "Пропуск, чтобы не испортить файл. Обновите mozg/mori-neutral.css."
        continue
    }

    # Вырезаем предыдущий блок, чтобы он не накапливался.
    $startIdx = $css.IndexOf($BeginMarker)
    if ($startIdx -ge 0) {
        $endIdx = $css.IndexOf($EndMarker, $startIdx)
        if ($endIdx -ge 0) {
            $css = $css.Remove($startIdx, ($endIdx + $EndMarker.Length) - $startIdx)
        }
        else {
            Write-Warn "[$($dir.Name)] найден BEGIN-маркер без END - файл повреждён, пропуск."
            continue
        }
    }

    # Бэкап держим в актуальном состоянии: он соответствует установленной версии.
    $origPath = "$cssPath.orig"
    $currentOriginal = $css.TrimEnd()
    $backupMatches = $false
    if (Test-Path -LiteralPath $origPath) {
        $backupMatches = ([System.IO.File]::ReadAllText($origPath).TrimEnd() -eq $currentOriginal)
    }
    if (-not $backupMatches) {
        [System.IO.File]::WriteAllText($origPath, $currentOriginal + "`n", [System.Text.UTF8Encoding]::new($false))
        Write-Info "[$($dir.Name)] бэкап обновлён: index.css.orig"
    }

    $css = $currentOriginal + "`n`n" + $block + "`n"

    # Атомарная запись: временный файл, затем подмена.
    $tempPath = "$cssPath.tmp"
    [System.IO.File]::WriteAllText($tempPath, $css, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $cssPath -Force

    Write-Ok "[$($dir.Name)] тема применена."
    $appliedCount += 1
}

if ($appliedCount -gt 0) {
    Write-Host ''
    Write-Host 'Перезагрузите окно: Ctrl+Shift+R' -ForegroundColor Cyan
    exit 0
}

# Ни одного файла не пропатчено (структура изменилась или файл отсутствует).
# Код 2 позволяет вызывающему скрипту отличить это от успеха.
Write-Host ''
Write-Host 'Тема не применена ни к одному расширению - см. предупреждения выше.' -ForegroundColor Yellow
exit 2

