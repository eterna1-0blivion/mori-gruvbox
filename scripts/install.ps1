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

# --- Удаление устаревшего блока настроек -------------------------------------
#
# Раньше нейтральные цвета задавались блоком "[Gruvbox Dark Hard]":
# { workbench.colorCustomizations } в settings.json. Теперь те же цвета
# находятся внутри темы, а блок действует только на старую Gruvbox.
# После установки темы его можно удалить.

function ConvertFrom-JsoncText {
    <#
        Убирает комментарии и висячие запятые, чтобы проверить settings.json.
        Сканер уважает строковые литералы (важно для URL вида https://...).
    #>
    param([string]$Text)

    $sb = New-Object System.Text.StringBuilder
    $i = 0
    $n = $Text.Length

    while ($i -lt $n) {
        $ch = $Text[$i]

        if ($ch -eq '"') {
            [void]$sb.Append($ch)
            $i++
            while ($i -lt $n) {
                $c = $Text[$i]
                [void]$sb.Append($c)
                if ($c -eq '\') {
                    if ($i + 1 -lt $n) {
                        [void]$sb.Append($Text[$i + 1])
                        $i += 2
                        continue
                    }
                    $i++
                    break
                }
                if ($c -eq '"') { $i++; break }
                $i++
            }
            continue
        }

        if ($ch -eq '/' -and ($i + 1) -lt $n) {
            if ($Text[$i + 1] -eq '/') {
                while ($i -lt $n -and $Text[$i] -ne "`n") { $i++ }
                continue
            }
            if ($Text[$i + 1] -eq '*') {
                $i += 2
                while (($i + 1) -lt $n -and -not ($Text[$i] -eq '*' -and $Text[$i + 1] -eq '/')) { $i++ }
                $i += 2
                continue
            }
        }

        [void]$sb.Append($ch)
        $i++
    }

    $json = $sb.ToString()
    return [regex]::Replace($json, ',(\s*[}\]])', '$1')
}

function Test-JsoncValid {
    param([string]$Text)

    try {
        $null = ConvertFrom-JsoncText -Text $Text | ConvertFrom-Json
        return $true
    }
    catch {
        return $false
    }
}

function Remove-JsoncKey {
    <#
        Удаляет ключ верхнего уровня вместе со значением из текста JSON/JSONC.
        Возвращает $null, если ключа нет. Форматирование остальных частей файла
        (комментарии, отступы) сохраняется - правка чисто текстовая.
    #>
    param(
        [string]$Text,
        [string]$Key
    )

    $needle = '"' + $Key + '"'
    $keyIdx = $Text.IndexOf($needle)
    if ($keyIdx -lt 0) { return $null }

    $colon = $Text.IndexOf(':', $keyIdx + $needle.Length)
    if ($colon -lt 0) { throw "Не удалось разобрать ключ $needle (нет двоеточия)." }

    # Ищем открывающую скобку значения объекта.
    $open = -1
    for ($i = $colon + 1; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]
        if ($ch -eq '{') { $open = $i; break }
        if (-not [char]::IsWhiteSpace($ch)) {
            throw "Ключ $needle содержит не объект - удаление не выполнено."
        }
    }
    if ($open -lt 0) { throw "Не удалось найти значение ключа $needle." }

    # Парная закрывающая скобка с учётом строковых литералов.
    $depth = 0
    $inString = $false
    $escaped = $false
    $close = -1

    for ($i = $open; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]

        if ($inString) {
            if ($escaped) { $escaped = $false }
            elseif ($ch -eq '\') { $escaped = $true }
            elseif ($ch -eq '"') { $inString = $false }
            continue
        }

        if ($ch -eq '"') { $inString = $true; continue }
        if ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') {
            $depth--
            if ($depth -eq 0) { $close = $i; break }
        }
    }

    if ($close -lt 0) { throw "Не удалось найти закрывающую скобку для $needle." }

    $start = $keyIdx
    $end = $close + 1

    # Сначала пробуем снять запятую после значения.
    $after = $end
    while ($after -lt $Text.Length -and [char]::IsWhiteSpace($Text[$after])) { $after++ }

    if ($after -lt $Text.Length -and $Text[$after] -eq ',') {
        $end = $after + 1
    }
    else {
        # Иначе запятая стоит перед ключом (ключ последний в объекте).
        $before = $start - 1
        while ($before -ge 0 -and [char]::IsWhiteSpace($Text[$before])) { $before-- }
        if ($before -ge 0 -and $Text[$before] -eq ',') { $start = $before }
    }

    return $Text.Remove($start, $end - $start)
}

function Remove-OldOverrides {
    <#
        Предлагает удалить блок настроек старой Gruvbox. Вызывается только
        после успешной установки темы.
    #>
    $settingsPath = Join-Path $env:APPDATA 'Code\User\settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath)) { return }

    $raw = [System.IO.File]::ReadAllText($settingsPath)
    $scopeKey = '[Gruvbox Dark Hard]'
    if (-not $raw.Contains('"' + $scopeKey + '"')) { return }

    Write-Host ''
    Write-Host ("    Найден блок настроек старой темы: `"$scopeKey`"") -ForegroundColor White
    Write-Host '    Те же цвета теперь внутри темы Mori Gruvbox; блок дублирует их' -ForegroundColor DarkGray
    Write-Host '    и действует только на старую Gruvbox. Его можно удалить.' -ForegroundColor DarkGray

    if (-not $Yes) {
        $answer = Read-Host '    Удалить этот блок из settings.json? [y/N]'
        if ($answer -notmatch '^(y|yes|д|да)$') {
            Write-Host '    Оставлен без изменений.' -ForegroundColor Yellow
            return
        }
    }

    try {
        $updated = Remove-JsoncKey -Text $raw -Key $scopeKey
    }
    catch {
        Write-Host ("    Не удалось удалить блок: " + $_.Exception.Message) -ForegroundColor Yellow
        return
    }

    if ($null -eq $updated) { return }

    # Убираем пустые строки, оставшиеся после удаления блока.
    $updated = [regex]::Replace($updated, '(\r?\n)[ \t]*(\r?\n)+', '$1')

    if (-not (Test-JsoncValid -Text $updated)) {
        Write-Host '    Правка сделала бы settings.json некорректным - пропуск.' -ForegroundColor Yellow
        return
    }

    $backup = "$settingsPath.bak-mori-gruvbox"
    [System.IO.File]::WriteAllText($backup, $raw, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($settingsPath, $updated, [System.Text.UTF8Encoding]::new($false))

    Write-Host "    Блок удалён. Бэкап: $(Split-Path -Leaf $backup)" -ForegroundColor Green
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
    if ($doVscode) { Write-Info '1) установить расширение-тему eterna1-0blivion.mori-gruvbox' }
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

    # ВАЖНО: элементы массива НЕ оборачиваем в кавычки. PowerShell сам
    # экранирует аргументы при запуске процесса; литеральные кавычки внутри
    # строки приводят к пути вида "D:\...\script.ps1" (с кавычками), из-за чего
    # pwsh завершается с кодом 64 (EX_USAGE), а Windows PowerShell 5.1 -
    # с ошибкой "Illegal characters in path".
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path)
    foreach ($key in $BoundParameters.Keys) {
        $value = $BoundParameters[$key]
        if ($value -is [switch] -or $value -is [bool]) {
            if ($value) { $argList += "-$key" }
        }
        else {
            $argList += @("-$key", [string]$value)
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

        # Блок настроек старой Gruvbox дублирует цвета новой темы - предлагаем убрать.
        Remove-OldOverrides
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

