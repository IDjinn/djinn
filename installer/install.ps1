<#
Djinn installer and updater for Windows.

  irm https://github.com/IDjinn/djinn-lang-v3/releases/latest/download/install.ps1 | iex
  powershell -File install.ps1 [-Mode install|update|extension|uninstall] [options]

Options:
  -Prefix <dir>       install location (default: $env:DJINN_HOME or %LOCALAPPDATA%\Djinn)
  -Version <tag>      install a specific release tag (default: latest)
  -Extension          also install the VS Code extension (skips the dialog)
  -NoExtension        do not install the VS Code extension (skips the dialog)
  -Ui                 also install the UI framework libraries (ui, ui_macros, win32)
  -Vulkan             also install the Vulkan renderer (vulkan, spirv, vulkan-1.lib); implies -Ui
  -Android            also install the Android target libraries and build tools (needs the Android SDK and NDK to use)
  -NoAutoUpdate       do not register the scheduled task
  -NoPath             do not change the user PATH
  -Quiet              print errors only; never shows the dialog

Layout: <prefix>\versions\<tag>\{bin,lib,runtime,std}   <prefix>\current (junction)   <prefix>\bin\djinn-setup.ps1
#>
param(
    [ValidateSet("install", "update", "extension", "uninstall")] [string] $Mode = "install",
    [string] $Prefix = "",
    [string] $Version = "",
    [switch] $Extension,
    [switch] $NoExtension,
    [switch] $Ui,
    [switch] $Vulkan,
    [switch] $Android,
    [switch] $NoAutoUpdate,
    [switch] $NoPath,
    [switch] $Quiet
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"

$Repo = if ($env:DJINN_REPO) { $env:DJINN_REPO } else { "IDjinn/djinn-lang-v3" }
if (-not $Prefix) { $Prefix = if ($env:DJINN_HOME) { $env:DJINN_HOME } else { Join-Path $env:LOCALAPPDATA "Djinn" } }
$TaskName = "Djinn Auto Update"

function Say($text) { if (-not $Quiet) { Write-Host $text } }

function Get-Platform {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -ne "AMD64") { throw "unsupported architecture $arch (only windows-x86_64 is published)" }
    return "windows-x86_64"
}

function Get-LatestTag {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "djinn-setup" }
    return $release.tag_name
}

function Get-CurrentTag {
    $link = Join-Path $Prefix "current"
    if (Test-Path $link) { return (Get-Item $link).Target | Split-Path -Leaf }
    return $null
}

function Get-CodeCli {
    foreach ($name in "code.cmd", "code-insiders.cmd", "codium.cmd") {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($found) { return $found.Source }
    }
    $local = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"
    if (Test-Path $local) { return $local }
    return $null
}

function Show-ExtensionDialog([bool] $codeFound) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Djinn Setup"
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size(460, 292)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "Install Djinn to $Prefix"
    $title.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $title.AutoSize = $true
    $title.Location = New-Object System.Drawing.Point(16, 16)
    $form.Controls.Add($title)

    $extensionBox = New-Object System.Windows.Forms.CheckBox
    $extensionBox.Text = "Install the VS Code extension (language server, highlighting, build, debug)"
    $extensionBox.Checked = $codeFound
    $extensionBox.Enabled = $codeFound
    $extensionBox.AutoSize = $true
    $extensionBox.Location = New-Object System.Drawing.Point(16, 60)
    $form.Controls.Add($extensionBox)

    $updateBox = New-Object System.Windows.Forms.CheckBox
    $updateBox.Text = "Keep Djinn up to date (scheduled task, every 6 hours)"
    $updateBox.Checked = $true
    $updateBox.AutoSize = $true
    $updateBox.Location = New-Object System.Drawing.Point(16, 90)
    $form.Controls.Add($updateBox)

    $pathBox = New-Object System.Windows.Forms.CheckBox
    $pathBox.Text = "Add Djinn to the PATH"
    $pathBox.Checked = $true
    $pathBox.AutoSize = $true
    $pathBox.Location = New-Object System.Drawing.Point(16, 120)
    $form.Controls.Add($pathBox)

    $uiBox = New-Object System.Windows.Forms.CheckBox
    $uiBox.Text = "UI framework libraries (ui, ui_macros and the Windows host)"
    $uiBox.AutoSize = $true
    $uiBox.Location = New-Object System.Drawing.Point(16, 150)
    $form.Controls.Add($uiBox)

    $vulkanBox = New-Object System.Windows.Forms.CheckBox
    $vulkanBox.Text = "Vulkan renderer for the UI (GPU drawing)"
    $vulkanBox.AutoSize = $true
    $vulkanBox.Enabled = $false
    $vulkanBox.Location = New-Object System.Drawing.Point(40, 180)
    $form.Controls.Add($vulkanBox)
    $uiBox.Add_CheckedChanged({ $vulkanBox.Enabled = $uiBox.Checked; if (-not $uiBox.Checked) { $vulkanBox.Checked = $false } })

    $androidBox = New-Object System.Windows.Forms.CheckBox
    $androidBox.Text = "Android target (libraries and build tools; needs the Android SDK and NDK)"
    $androidBox.AutoSize = $true
    $androidBox.Location = New-Object System.Drawing.Point(16, 210)
    $form.Controls.Add($androidBox)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "Install"
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $ok.Location = New-Object System.Drawing.Point(284, 252)
    $form.Controls.Add($ok)
    $form.AcceptButton = $ok

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "Cancel"
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancel.Location = New-Object System.Drawing.Point(370, 252)
    $form.Controls.Add($cancel)
    $form.CancelButton = $cancel

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
    return @{ Extension = $extensionBox.Checked; AutoUpdate = $updateBox.Checked; Path = $pathBox.Checked; Ui = $uiBox.Checked; Vulkan = $vulkanBox.Checked; Android = $androidBox.Checked }
}

# Optional components are staged in the release under optional\<name>\ with the layout of the install. The picked
# ones are copied over the version folder and the staging folder goes away. The picks are remembered in
# <prefix>\.components, so an update keeps them.
function Get-SavedComponents {
    $file = Join-Path $Prefix ".components"
    if (Test-Path $file) { return @(Get-Content $file | Where-Object { $_ }) }
    return @()
}

function Install-Components($target, [bool] $ui, [bool] $vulkan, [bool] $android) {
    $staged = Join-Path $target "optional"
    $picked = @()
    if ($ui) { $picked += "ui" }
    if ($ui -and $vulkan) { $picked += "vulkan" }
    if ($android) { $picked += "android" }
    foreach ($name in $picked) {
        $source = Join-Path $staged $name
        if (Test-Path $source) { Copy-Item (Join-Path $source "*") $target -Recurse -Force }
        else { Say "warning: this release has no '$name' component" }
    }
    if (Test-Path $staged) { Remove-Item $staged -Recurse -Force }
    Set-Content (Join-Path $Prefix ".components") $picked
}

function Install-Extension($tag, $tmp) {
    $cli = Get-CodeCli
    if (-not $cli) { Say "VS Code was not found; install the extension later with: djinn-setup.ps1 -Mode extension"; return }
    $file = Join-Path $tmp "djinn-lang.vsix"
    try {
        Invoke-WebRequest "https://github.com/$Repo/releases/download/$tag/djinn-lang.vsix" -OutFile $file
    } catch { Say "warning: this release has no extension package"; return }
    & $cli --install-extension $file --force | Out-Null
    if ($LASTEXITCODE -eq 0) { Say "VS Code extension installed"; New-Item -ItemType File -Force (Join-Path $Prefix ".extension") | Out-Null }
    else { Say "warning: could not install the extension" }
}

function Register-UpdateTask {
    $script = Join-Path $Prefix "bin\djinn-setup.ps1"
    $action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Mode update -Quiet"
    schtasks.exe /Create /TN $TaskName /TR $action /SC HOURLY /MO 6 /F | Out-Null
    if ($LASTEXITCODE -eq 0) { Say "auto update scheduled (every 6 hours)" } else { Say "warning: could not register the scheduled task" }
}

function Add-ToPath {
    $entries = @((Join-Path $Prefix "current\bin"), (Join-Path $Prefix "bin"))
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = if ($user) { $user.Split(";") | Where-Object { $_ } } else { @() }
    foreach ($entry in $entries) { if ($parts -notcontains $entry) { $parts += $entry } }
    [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
    [Environment]::SetEnvironmentVariable("DJINN_HOME", $Prefix, "User")
    Say "added Djinn to the user PATH (open a new terminal)"
}

function Set-CurrentLink($tag) {
    $link = Join-Path $Prefix "current"
    if (Test-Path $link) { cmd.exe /c rmdir "`"$link`"" | Out-Null }
    New-Item -ItemType Junction -Path $link -Target (Join-Path $Prefix "versions\$tag") | Out-Null
}

function Install-Release {
    $platform = Get-Platform
    $tag = if ($Version) { $Version } else { Get-LatestTag }
    if (-not $tag) { throw "could not find the latest release of $Repo" }
    $installed = Get-CurrentTag
    if ($Mode -eq "update") {
        if (-not $installed) { throw "Djinn is not installed in $Prefix" }
        if ($installed -eq $tag) { Say "Djinn $tag is up to date"; return }
    }

    $saved = Get-SavedComponents
    $choices = @{ Extension = [bool]$Extension; AutoUpdate = -not $NoAutoUpdate; Path = -not $NoPath
        Ui = ([bool]$Ui -or [bool]$Vulkan -or ($saved -contains "ui")); Vulkan = ([bool]$Vulkan -or ($saved -contains "vulkan")); Android = ([bool]$Android -or ($saved -contains "android")) }
    if ($Mode -eq "install" -and -not $Extension -and -not $NoExtension) {
        $code = [bool](Get-CodeCli)
        if ($Quiet -or -not [Environment]::UserInteractive) {
            $choices.Extension = $code
        } else {
            $picked = Show-ExtensionDialog $code
            if ($null -eq $picked) { Say "cancelled"; return }
            $choices = $picked
        }
    }

    $name = "djinn-$tag-$platform"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("djinn-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Say "Downloading Djinn $tag ($platform)"
        $zip = Join-Path $tmp "$name.zip"
        Invoke-WebRequest "https://github.com/$Repo/releases/download/$tag/$name.zip" -OutFile $zip
        try {
            Invoke-WebRequest "https://github.com/$Repo/releases/download/$tag/$name.zip.sha256" -OutFile "$zip.sha256"
            $expected = ((Get-Content "$zip.sha256" -Raw).Trim() -split "\s+")[0]
            $actual = (Get-FileHash $zip -Algorithm SHA256).Hash
            if ($expected -ne $actual) { throw "checksum mismatch for $name.zip" }
        } catch [System.Net.WebException] { Say "warning: no checksum published" }

        $versions = Join-Path $Prefix "versions"
        New-Item -ItemType Directory -Force $versions, (Join-Path $Prefix "bin") | Out-Null
        $partial = Join-Path $versions "$tag.partial"
        if (Test-Path $partial) { Remove-Item $partial -Recurse -Force }
        Expand-Archive $zip -DestinationPath $partial
        $target = Join-Path $versions $tag
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Move-Item (Join-Path $partial $name) $target
        Remove-Item $partial -Recurse -Force
        Install-Components $target $choices.Ui $choices.Vulkan $choices.Android
        Set-CurrentLink $tag

        # stable copy of this script for the scheduled task
        $stable = Join-Path $Prefix "bin\djinn-setup.ps1"
        if ($PSCommandPath -and (Test-Path $PSCommandPath)) { Copy-Item $PSCommandPath $stable -Force }
        else { Invoke-WebRequest "https://github.com/$Repo/releases/download/$tag/install.ps1" -OutFile $stable }

        # keep the two newest versions; a running language server may lock the older one
        Get-ChildItem $versions -Directory | Where-Object { $_.Name -notlike "*.partial" } |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip 2 | ForEach-Object {
                if ($_.Name -ne $tag) { try { Remove-Item $_.FullName -Recurse -Force } catch {} }
            }

        if ($Mode -eq "install") {
            if ($choices.Path) { Add-ToPath }
            if ($choices.AutoUpdate) { Register-UpdateTask }
        }
        if ($choices.Extension -or ($Mode -eq "update" -and (Test-Path (Join-Path $Prefix ".extension")))) {
            Install-Extension $tag $tmp
        }
        Say "Djinn $tag installed in $target (restart VS Code to pick it up)"
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

switch ($Mode) {
    "install" { Install-Release }
    "update" { Install-Release }
    "extension" {
        $tag = Get-CurrentTag
        if (-not $tag) { throw "Djinn is not installed in $Prefix" }
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ("djinn-" + [Guid]::NewGuid())
        New-Item -ItemType Directory -Path $tmp | Out-Null
        try { Install-Extension $tag $tmp } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    "uninstall" {
        schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
        $link = Join-Path $Prefix "current"
        if (Test-Path $link) { cmd.exe /c rmdir "`"$link`"" | Out-Null }
        Remove-Item $Prefix -Recurse -Force
        Say "Djinn removed (PATH entries can be removed from the user environment)"
    }
}
