# Тест функций удаления блока из settings.json (JSONC).
# Импортирует функции из install.ps1 без выполнения его основного тела.
$ErrorActionPreference = 'Stop'

$src = Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) 'install.ps1'
if (-not (Test-Path -LiteralPath $src)) {
    Write-Host "install.ps1 не найден: $src" -ForegroundColor Red
    exit 1
}
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($src, [ref]$tokens, [ref]$parseErrors)

$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
if ($funcs.Count -eq 0) {
    Write-Host 'Не удалось загрузить функции из install.ps1' -ForegroundColor Red
    exit 1
}

# Собираем все определения функций в один блок и выполняем в текущем scope:
# точка внутри цикла действовала бы только на время итерации.
$defs = ($funcs | ForEach-Object { $_.Extent.Text }) -join "`n`n"
. ([scriptblock]::Create($defs))

$failures = 0

function Assert {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) {
        Write-Host "  OK   $Name" -ForegroundColor Green
    }
    else {
        Write-Host "  FAIL $Name $Detail" -ForegroundColor Red
        $script:failures++
    }
}

$block = @'
    "[Gruvbox Dark Hard]": {
        "workbench.colorCustomizations": {
            "editor.background": "#1f1f1f",
            "sideBar.background": "#181818"
        }
    }
'@

# --- 1. Блок в середине файла ------------------------------------------------
$case1 = @"
{
    "editor.fontSize": 14,
$block,
    "workbench.colorTheme": "Gruvbox Dark Hard"
}
"@
$out1 = Remove-JsoncKey -Text $case1 -Key '[Gruvbox Dark Hard]'
Assert 'middle: removed' ($null -ne $out1 -and -not $out1.Contains('"[Gruvbox Dark Hard]"'))
Assert 'middle: keeps siblings' ($out1.Contains('"editor.fontSize": 14') -and $out1.Contains('"workbench.colorTheme": "Gruvbox Dark Hard"'))
Assert 'middle: valid JSON' (Test-JsoncValid -Text $out1)

# --- 2. Блок последний в файле (запятая перед ним) ---------------------------
$case2 = @"
{
    "editor.fontSize": 14,
$block
}
"@
$out2 = Remove-JsoncKey -Text $case2 -Key '[Gruvbox Dark Hard]'
Assert 'last: removed' ($null -ne $out2 -and -not $out2.Contains('[Gruvbox Dark Hard]'))
Assert 'last: valid JSON' (Test-JsoncValid -Text $out2)
Assert 'last: no trailing comma' (-not ($out2 -match ',\s*\}'))

# --- 3. Блок первый в файле (запятая после него) -----------------------------
$case3 = @"
{
$block,
    "editor.fontSize": 14
}
"@
$out3 = Remove-JsoncKey -Text $case3 -Key '[Gruvbox Dark Hard]'
Assert 'first: removed' ($null -ne $out3 -and -not $out3.Contains('[Gruvbox Dark Hard]'))
Assert 'first: valid JSON' (Test-JsoncValid -Text $out3)

# --- 4. Файл с комментариями и висячей запятой ------------------------------
$case4 = @"
{
    // размер шрифта
    "editor.fontSize": 14,
$block,
    "workbench.colorTheme": "Gruvbox Dark Hard", // активная тема
}
"@
$out4 = Remove-JsoncKey -Text $case4 -Key '[Gruvbox Dark Hard]'
Assert 'jsonc: removed' ($null -ne $out4 -and -not $out4.Contains('[Gruvbox Dark Hard]'))
Assert 'jsonc: valid' (Test-JsoncValid -Text $out4)
Assert 'jsonc: keeps comments' ($out4.Contains('// размер шрифта'))

# --- 5. URL с // внутри строки не считается комментарием --------------------
$case5 = @"
{
    "homepage": "https://example.com/a",
$block,
    "editor.fontSize": 14
}
"@
$out5 = Remove-JsoncKey -Text $case5 -Key '[Gruvbox Dark Hard]'
Assert 'url: removed' ($null -ne $out5 -and -not $out5.Contains('[Gruvbox Dark Hard]'))
Assert 'url: string intact' ($out5.Contains('https://example.com/a'))
Assert 'url: valid JSON' (Test-JsoncValid -Text $out5)

# --- 6. Ключа нет -----------------------------------------------------------
$case6 = '{ "editor.fontSize": 14 }'
$out6 = Remove-JsoncKey -Text $case6 -Key '[Gruvbox Dark Hard]'
Assert 'absent: returns null' ($null -eq $out6)

# --- 7. Значение не объект --------------------------------------------------
$case7 = '{ "[Gruvbox Dark Hard]": "oops", "a": 1 }'
$threw = $false
try { Remove-JsoncKey -Text $case7 -Key '[Gruvbox Dark Hard]' | Out-Null } catch { $threw = $true }
Assert 'non-object: rejects' $threw

Write-Host ''
if ($failures -eq 0) {
    Write-Host 'ВСЕ ТЕСТЫ ПРОЙДЕНЫ' -ForegroundColor Green
    exit 0
}
Write-Host "ПРОВАЛЕНО: $failures" -ForegroundColor Red
exit 1
