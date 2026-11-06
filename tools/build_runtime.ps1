param([string] $Out = "")

$bash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $bash)) { $bash = (Get-Command bash -ErrorAction Stop).Source }
$script = Join-Path $PSScriptRoot "build_runtime.sh"
$arguments = @($script)
if ($Out) { $arguments += @("--out", $Out) }

& $bash @arguments
exit $LASTEXITCODE
