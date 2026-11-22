<#
.SYNOPSIS
    Генерирует assets/icon.png для расширения Mori Gruvbox.

.DESCRIPTION
    Иконка 256x256: тёмный скруглённый квадрат (нейтральный фон темы),
    поверх - стилизованная буква "M": левая половина в грувбокс-оранжевом,
    правая - нейтрально-серая. Метафора темы: Gruvbox остаётся,
    интерфейс становится серым.

    Требуется Windows (System.Drawing). Запуск:
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icon.ps1
#>
[CmdletBinding()]
param(
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot не заполнен на этапе привязки параметров в PowerShell 5.1,
# поэтому путь по умолчанию вычисляем в теле скрипта.
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $OutFile = Join-Path (Split-Path -Parent $PSCommandPath) '..\assets\icon.png'
}

Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# --- Фон: скруглённый квадрат с цветом панели темы -------------------------
$radius = 52
$rect = New-Object System.Drawing.Rectangle(8, 8, ($size - 16), ($size - 16))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc(($rect.Right - $d), $rect.Y, $d, $d, 270, 90)
$path.AddArc(($rect.Right - $d), ($rect.Bottom - $d), $d, $d, 0, 90)
$path.AddArc($rect.X, ($rect.Bottom - $d), $d, $d, 90, 90)
$path.CloseFigure()

$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#181818'))
$g.FillPath($bgBrush, $path)

# Лёгкая внутренняя рамка - граница панелей темы (#2b2b2b)
$borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#2b2b2b'), 2)
$g.DrawPath($borderPen, $path)

# --- Буква M: путь из четырёх отрезков -------------------------------------
$penWidth = 30
$mPoints = @(
    (New-Object System.Drawing.Point(74, 190)),
    (New-Object System.Drawing.Point(74, 78)),
    (New-Object System.Drawing.Point(128, 148)),
    (New-Object System.Drawing.Point(182, 78)),
    (New-Object System.Drawing.Point(182, 190))
)

$leftPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#d65d0e'), $penWidth)
$leftPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$leftPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$leftPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$rightPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#8a8a8a'), $penWidth)
$rightPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$rightPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$rightPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# Клеим по половинам: левая - грувбокс, правая - нейтраль.
$leftClip = New-Object System.Drawing.Rectangle(0, 0, 128, $size)
$rightClip = New-Object System.Drawing.Rectangle(128, 0, 128, $size)

$g.SetClip($leftClip)
$g.DrawLines($leftPen, [System.Drawing.Point[]]$mPoints)

$g.SetClip($rightClip)
$g.DrawLines($rightPen, [System.Drawing.Point[]]$mPoints)

$g.ResetClip()

# --- Сохранение -------------------------------------------------------------
$dir = Split-Path -Parent $OutFile
if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Host "Иконка создана: $OutFile" -ForegroundColor Green
