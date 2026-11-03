param([Parameter(ValueFromRemainingArguments)] [string[]] $CompilerArgs)

$bash = (Get-Command bash -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot "playground.sh"
& $bash $script @CompilerArgs
exit $LASTEXITCODE
