param(
    [Parameter(Mandatory)] [string] $Stage0,
    [Parameter(Mandatory)] [string] $RuntimeDir,
    [string] $RuntimeLib = "",
    [switch] $Lld,
    [string] $Out = "",
    [string] $BenchRef = "",
    [switch] $UpdateRef
)

$bash = (Get-Command bash -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot "bootstrap.sh"
$arguments = @($script, "--stage0", $Stage0, "--runtime-dir", $RuntimeDir)
if ($RuntimeLib) { $arguments += @("--runtime-lib", $RuntimeLib) }
if ($Lld) { $arguments += "--lld" }
if ($Out) { $arguments += @("--out", $Out) }
if ($BenchRef) { $arguments += @("--bench-ref", $BenchRef) }
if ($UpdateRef) { $arguments += "--update-ref" }

& $bash @arguments
exit $LASTEXITCODE
