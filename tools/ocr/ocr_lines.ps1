# ページの画像を Windows の OCR で読み、行ごとの字と位置（x, y, 幅, 高さ）を TSV にする。
# 目で確かめる所を画像から切り出すのに使う。
# 使い方: powershell -ExecutionPolicy Bypass -File tools\ocr\ocr_lines.ps1 -Dir ocr\_work\r07 -Out ocr\lines\r07.tsv
param([string]$Dir, [string]$Out)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [type]$t) {
  $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$lang = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -eq 'ja' } | Select-Object -First 1
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)

$rows = New-Object System.Collections.Generic.List[string]
Get-ChildItem (Resolve-Path $Dir) -Filter 'p*.png' | Sort-Object Name | ForEach-Object {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  foreach ($line in $res.Lines) {
    $xs = $line.Words | ForEach-Object { $_.BoundingRect }
    $x0 = ($xs | Measure-Object -Property X -Minimum).Minimum
    $y0 = ($xs | Measure-Object -Property Y -Minimum).Minimum
    $x1 = ($xs | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
    $y1 = ($xs | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
    $text = $line.Text -replace '(?<![A-Za-z0-9]) | (?![A-Za-z0-9])', ''
    $rows.Add("$($_.BaseName)`t$([int]$x0)`t$([int]$y0)`t$([int]$x1)`t$([int]$y1)`t$text")
  }
}
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
[IO.File]::WriteAllText($Out, ($rows -join "`n"), (New-Object System.Text.UTF8Encoding $false))
Write-Host "$Out : $($rows.Count) 行"
