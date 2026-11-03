param([Parameter(ValueFromRemainingArguments)] [string[]] $ScriptArgs)

$bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
if (-not $bash) { $bash = "C:\Program Files\Git\bin\bash.exe" }
if (-not (Test-Path $bash)) {
    Write-Error "bash not found: install Git for Windows"
    exit 1
}

foreach ($dir in @("C:\Program Files\LLVM\bin")) {
    if ((Test-Path $dir) -and ($env:PATH -notlike "*$dir*")) { $env:PATH += ";$dir" }
}

& $bash "$PSScriptRoot/run.sh" @ScriptArgs
exit $LASTEXITCODE
