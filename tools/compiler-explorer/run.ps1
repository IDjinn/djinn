param([Parameter(ValueFromRemainingArguments)] [string[]] $ScriptArgs)

$bash = $null
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if ($git) {
    $gitRoot = Split-Path -Parent (Split-Path -Parent $git)
    $bash = @("$gitRoot\bin\bash.exe", "$gitRoot\usr\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $bash) {
    $bash = @("C:\Program Files\Git\bin\bash.exe", "C:\Program Files (x86)\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $bash) {
    Write-Error "Git for Windows bash not found (the WSL bash.exe is not usable here)"
    exit 1
}

foreach ($dir in @("C:\Program Files\LLVM\bin")) {
    if ((Test-Path $dir) -and ($env:PATH -notlike "*$dir*")) { $env:PATH += ";$dir" }
}

& $bash "$PSScriptRoot/run.sh" @ScriptArgs
exit $LASTEXITCODE
