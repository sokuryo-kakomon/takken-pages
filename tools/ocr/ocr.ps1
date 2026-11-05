# 宅建の過去問 PDF（RETIO 公表）を取ってきて、Windows に入っている OCR で文字にする。
# 本人が1回実行する: powershell -ExecutionPolicy Bypass -File tools\ocr\ocr.ps1
# 年を絞るとき: ... -File tools\ocr\ocr.ps1 -Years r07,r06
# 出力: ocr\<年>\pNN.txt（ページごと）と ocr\<年>.txt（まとめ）。PDF とページの画像は ocr\_work\ に置く。
# 試し: -TestPdf <PDF> で任意の PDF を ocr\_test\ に文字にする
param([string[]]$Years, [string]$TestPdf)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outRoot = Join-Path $root 'ocr'
$work = Join-Path $outRoot '_work'
New-Item -ItemType Directory -Force $work | Out-Null

$B = 'https://www.retio.or.jp/wp-content/uploads'
$pdfs = [ordered]@{
  'r07'    = "$B/2025/12/R7_question_answer.pdf"
  'r06'    = "$B/2025/03/R6_question_answer.pdf"
  'r05'    = "$B/2025/03/R5_qestion_answer%E3%80%80.pdf"
  'r04'    = "$B/2024/10/R4-q_a.pdf"
  'r03-12' = "$B/2024/12/R3-question_002.pdf"
  'r03-10' = "$B/2024/12/R3-question.pdf"
  'r02-12' = "$B/2024/10/R2-question_002.pdf"
  'r02-10' = "$B/2024/10/R2-question.pdf"
  'r01'    = "$B/2024/10/R1-q_a.pdf"
  'h30'    = "$B/2024/10/H30-q_a.pdf"
  'h29'    = "$B/2024/10/H29-q_a.pdf"
  'h28'    = "$B/2024/10/H28-q_a.pdf"
  'h27'    = "$B/2024/10/H27-q_a.pdf"
}
if ($TestPdf) { $pdfs = [ordered]@{ '_test' = '' }; $keys = @('_test') }
elseif ($Years) { $keys = $Years } else { $keys = $pdfs.Keys }

# Windows Runtime の非同期を待つ道具
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
if (-not $engine) { throw '日本語の OCR が入っていません（設定 > 時刻と言語 > 言語 で日本語を追加）' }

function Ocr-Png([string]$path) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  # 日本語の OCR は字の間に空白を入れるので、英数字どうしの間以外の空白を消す
  ($res.Lines | ForEach-Object { ($_.Text -replace '(?<![A-Za-z0-9]) | (?![A-Za-z0-9])', '') }) -join "`n"
}

$utf8 = New-Object System.Text.UTF8Encoding $false
foreach ($y in $keys) {
  $url = $pdfs[$y]
  if ($TestPdf) { $pdf = $TestPdf }
  else {
    if (-not $url) { Write-Host "知らない年: $y"; continue }
    $pdf = Join-Path $work "$y.pdf"
    if (-not (Test-Path $pdf)) { Invoke-WebRequest -Uri $url -OutFile $pdf -UseBasicParsing }
  }
  $img = Join-Path $work $y
  $n = python (Join-Path $PSScriptRoot 'render.py') $pdf $img
  $dir = Join-Path $outRoot $y
  New-Item -ItemType Directory -Force $dir | Out-Null
  $all = @()
  Get-ChildItem $img -Filter 'p*.png' | Sort-Object Name | ForEach-Object {
    $txt = Ocr-Png $_.FullName
    [IO.File]::WriteAllText((Join-Path $dir ($_.BaseName + '.txt')), $txt, $utf8)
    $all += "===== $($_.BaseName) =====`n$txt"
  }
  [IO.File]::WriteAllText((Join-Path $outRoot "$y.txt"), ($all -join "`n"), $utf8)
  Write-Host "$y : $n ページ"
}
Write-Host "できました: $outRoot"
