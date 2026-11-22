<#
.SYNOPSIS
    Устанавливает Mori Gruvbox: тему VS Code и/или тему интерфейса Mozg.

.DESCRIPTION
    Обёртка над двумя независимыми скриптами:

      1. install-vscode-theme.ps1 - расширение-тема "Mori Gruvbox" (.vsix);
      2. install-mozg-theme.ps1   - патч интерфейса расширения Mozg.

    Для каждой части задаётся свой вопрос, поэтому можно поставить только
    одну из них. Отказ от одной части не мешает установке другой.

.PARAMETER Only
    Ограничить набор: vscode (только тема редактора) или mozg (только Mozg).

.PARAMETER Yes
    Не задавать вопросов (для автоматизации). Включает обе части.

.PARAMETER WhatIf
    Показать, что будет сделано, ничего не меняя.

.PARAMETER SetActive
    После установки темы VS Code сделать её активной: аккуратно правится
    workbench.colorTheme в settings.json (с бэкапом и отдельным вопросом).

.PARAMETER CodeCommand
    Путь к code / code-insiders / codium (передаётся в install-vscode-theme.ps1).

.PARAMETER ExtensionsDir
    Каталог расширений для тестовой установки в изоляции.

.PARAMETER UserDataDir
    Каталог данных пользователя для тестовой установки в изоляции.

.PARAMETER MozgExtensionsRoot
    Каталог расширений, где искать mori-ai.mori-code (для тестов в изоляции).

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Only mozg

.EXAMPLE
    .\install.ps1 -Yes -SetActive
#>
[CmdletBinding()]
param(
    [ValidateSet('vscode', 'mozg', 'both')]
    [string]$Only = 'both',
    [switch]$Yes,
    [switch]$WhatIf,
    [switch]$SetActive,
    [string]$CodeCommand,
    [string]$ExtensionsDir,
    [string]$UserDataDir,
    [string]$MozgExtensionsRoot
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$ThemeName = 'Mori Gruvbox Dark Hard'

function Write-Step($text) { Write-Host "`n=== $text" -ForegroundColor Magenta }
function Write-Info($text) { Write-Host "    $text" -ForegroundColor DarkGray }

function Confirm-Part {
    param([string]$Question)

    if ($Yes) { return $true }
    $answer = Read-Host "$Question [y/N]"
    return ($answer -match '^(y|yes|д|да)$')
}

# --- Активная тема VS Code ---------------------------------------------------
function Set-ActiveTheme {
    param([string]$Name, [switch]$SkipConfirm)

    $settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        Write-Host "    settings.json не найден: $settingsPath" -ForegroundColor Yellow
        return
    }

    if (-not $SkipConfirm -and -not $Yes) {
        Write-Host ''
        Write-Host "    Сделать '$Name' активной темой?" -ForegroundColor White
        Write-Host '    Изменится workbench.colorTheme в settings.json (бэкап создаётся).' -ForegroundColor DarkGray
        $answer = Read-Host '    Применить? [y/N]'
        if ($answer -notmatch '^(y|yes|д|да)$') {
            Write-Host '    Пропущено - тему можно выбрать вручную: Ctrl+K Ctrl+T' -ForegroundColor Yellow
            return
        }
    }

    $raw = [System.IO.File]::ReadAllText($settingsPath)

    $backup = "$settingsPath.bak-mori-gruvbox"
    [System.IO.File]::WriteAllText($backup, $raw, [System.Text.UTF8Encoding]::new($false))
    Write-Info "бэкап настроек: $(Split-Path -Leaf $backup)"

    $pattern = '"workbench\.colorTheme"\s*:\s*"[^"]*"'
    $replacement = '"workbench.colorTheme": "' + $Name + '"'

    if ([regex]::IsMatch($raw, $pattern)) {
        $updated = [regex]::Replace($raw, $pattern, $replacement, 1)
    }
    else {
        # Ключа нет: вставляем первым свойством после открывающей скобки.
        $open = $raw.IndexOf('{')
        if ($open -lt 0) { throw "Некорректный settings.json: не найдена открывающая скобка." }
        $updated = $raw.Insert($open + 1, "`n    " + $replacement + ',')
    }

    # Проверяем, что получился валидный JSON, прежде чем записывать.
    try {
        $null = $updated | ConvertFrom-Json
    }
    catch {
        throw "Правка settings.json дала некорректный JSON - изменения не применены."
    }

    [System.IO.File]::WriteAllText($settingsPath, $updated, [System.Text.UTF8Encoding]::new($false))
    Write-Host "    Активная тема: $Name" -ForegroundColor Green
}

# --- Выполнение --------------------------------------------------------------
Write-Host ''
Write-Host 'Mori Gruvbox' -ForegroundColor White
Write-Host 'Gruvbox-подсветка кода + нейтральный интерфейс' -ForegroundColor DarkGray

$doVscode = ($Only -eq 'vscode' -or $Only -eq 'both')
$doMozg = ($Only -eq 'mozg' -or $Only -eq 'both')

if ($WhatIf) {
    Write-Host ''
    Write-Host 'Режим -WhatIf: изменения не вносятся.' -ForegroundColor Yellow
    if ($doVscode) { Write-Info '1) установить расширение-тему vl4dislaw.mori-gruvbox' }
    if ($doMozg) { Write-Info '2) пропатчить index.css расширения mori-ai.mori-code' }
    if ($SetActive) { Write-Info "3) сделать '$ThemeName' активной темой" }
    return
}

$results = @{ vscode = $null; mozg = $null }

# Подскрипты запускаются отдельным процессом PowerShell: при вызове .ps1 через
# оператор & переменная $LASTEXITCODE не обновляется, поэтому код возврата
# иначе остался бы от предыдущей нативной команды.
function Invoke-ChildScript {
    param(
        [string]$FileName,
        [hashtable]$BoundParameters = @{}
    )

    $path = Join-Path $Root "scripts\$FileName"

    if ($PSVersionTable.PSEdition -eq 'Core') {
        $pwshExe = (Get-Process -Id $PID).Path
    }
    else {
        $pwshExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    }

    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $path))
    foreach ($key in $BoundParameters.Keys) {
        $value = $BoundParameters[$key]
        if ($value -is [switch] -or $value -is [bool]) {
            if ($value) { $argList += "-$key" }
        }
        else {
            $argList += @("-$key", ('"{0}"' -f $value))
        }
    }

    & $pwshExe @argList | Out-Host
    return $LASTEXITCODE
}

# --- Часть 1: тема VS Code ---------------------------------------------------
if ($doVscode) {
    Write-Step 'Часть 1 из 2: тема VS Code'
    if (Confirm-Part '   Установить расширение-тему Mori Gruvbox?') {
        $childArgs = @{ Yes = $true }
        if ($CodeCommand) { $childArgs['CodeCommand'] = $CodeCommand }
        if ($ExtensionsDir) { $childArgs['ExtensionsDir'] = $ExtensionsDir }
        if ($UserDataDir) { $childArgs['UserDataDir'] = $UserDataDir }

        $code = Invoke-ChildScript -FileName 'install-vscode-theme.ps1' -BoundParameters $childArgs
        if ($code -ne 0) { throw "Установка темы VS Code завершилась с кодом $code." }

        $results.vscode = 'установлена'
        if ($SetActive) { Set-ActiveTheme -Name $ThemeName }
    }
    else {
        Write-Host '    Пропущено.' -ForegroundColor Yellow
        $results.vscode = 'пропущено'
    }
}

# --- Часть 2: тема Mozg ------------------------------------------------------
if ($doMozg) {
    Write-Step 'Часть 2 из 2: интерфейс Mozg'
    if (Confirm-Part '   Применить тему к интерфейсу расширения Mozg?') {
        $childArgs = @{ Yes = $true }
        if ($MozgExtensionsRoot) { $childArgs['ExtensionsRoot'] = $MozgExtensionsRoot }

        $code = Invoke-ChildScript -FileName 'install-mozg-theme.ps1' -BoundParameters $childArgs

        if ($code -eq 0) {
            $results.mozg = 'применена'
        }
        elseif ($code -eq 2) {
            Write-Host '    Тема Mozg не применена: структура index.css не совпала.' -ForegroundColor Yellow
            $results.mozg = 'НЕ применена (несовпадение структуры)'
        }
        else {
            throw "Патч Mozg завершился с кодом $code."
        }
    }
    else {
        Write-Host '    Пропущено.' -ForegroundColor Yellow
        $results.mozg = 'пропущено'
    }
}

# --- Итог --------------------------------------------------------------------
Write-Host ''
Write-Host 'Итог:' -ForegroundColor Cyan
if ($doVscode) { Write-Host ("  тема VS Code : " + $results.vscode) }
if ($doMozg) { Write-Host ("  тема Mozg    : " + $results.mozg) }

$anyApplied = ($results.vscode -eq 'установлена') -or ($results.mozg -eq 'применена')

if ($anyApplied) {
    Write-Host ''
    Write-Host 'Перезагрузите окно VS Code: Ctrl+Shift+R' -ForegroundColor Cyan
    if ($results.vscode -eq 'установлена') {
        Write-Host 'Выбор темы: Ctrl+K Ctrl+T -> "Mori Gruvbox Dark Hard"' -ForegroundColor DarkGray
    }
    Write-Host 'Откат: scripts\install-mozg-theme.ps1 -Revert  |  scripts\install-vscode-theme.ps1 -Uninstall' -ForegroundColor DarkGray
}
else {
    Write-Host ''
    Write-Host 'Изменений не внесено.' -ForegroundColor Yellow
}

