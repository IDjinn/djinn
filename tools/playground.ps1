param([Parameter(ValueFromRemainingArguments)] [string[]] $CompilerArgs)

$root = Split-Path -Parent $PSScriptRoot
$compiler = $env:DJINNC
if (-not $compiler) {
    $candidates = @(
        "$root\build\bootstrap\stage2\djinnc.exe",
        "$root\build\bsa\stage2\djinnc.exe",
        "$root\djinnc\build\djinnc.exe"
    ) | Where-Object { Test-Path $_ } | Sort-Object { (Get-Item $_).LastWriteTime } -Descending
    $compiler = $candidates | Select-Object -First 1
}
if (-not $compiler -or -not (Test-Path $compiler)) {
    Write-Error "djinnc not found: run tools/bootstrap.ps1 or set DJINNC"
    exit 1
}

$runtime = $env:DJINN_RUNTIME_DIR
if (-not $runtime) { $runtime = "$root\cmake-build-debug-visual-studio\runtime" }
if (-not (Test-Path $runtime)) { $runtime = "$root\runtime" }

$llvm = "C:\Program Files\LLVM\bin"
if ((Test-Path $llvm) -and ($env:PATH -notlike "*$llvm*")) { $env:PATH += ";$llvm" }

New-Item -ItemType Directory -Force "$root\playground\build" | Out-Null
$out = "$root\playground\build\playground.exe"

& $compiler "$root\playground\main.djinn" -o $out --runtime-dir $runtime @CompilerArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $out
$code = $LASTEXITCODE
Write-Host "exit code: $code"
exit $code
