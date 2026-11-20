; Djinn setup wizard for Windows (Inno Setup 6). Per-user install, no administrator rights.
;
;   ISCC.exe /DTag=v0.5.0 /DSource=<unpacked djinn-v0.5.0-windows-x86_64 dir> /DVsix=<djinn-lang.vsix> installer\windows\djinn.iss
;
; Silent install:  djinn-<tag>-windows-x86_64-setup.exe /VERYSILENT /TASKS="extension,autoupdate,addtopath" /COMPONENTS="core,ui,ui\vulkan"
;
; Optional components are staged in the unpacked release under optional\<component>\ with the same layout as the
; install (lib\*.djlib, native\...): optional\ui (ui, ui_macros, win32) and optional\vulkan (spirv, vulkan, vulkan-1.lib) and optional\android (target libraries, build tools).
;
; Layout (same as installer\install.ps1, which the scheduled task runs to update):
;   {app}\versions\<tag>\{bin,lib,runtime,std}   {app}\current (junction)   {app}\bin\djinn-setup.ps1

#ifndef Tag
  #define Tag "v0.0.0"
#endif
#ifndef Source
  #error Pass /DSource=<directory with bin, lib, runtime and std>
#endif
#ifndef Vsix
  #error Pass /DVsix=<path to djinn-lang.vsix>
#endif
#define Version StringChange(Tag, "v", "")

[Setup]
AppId={{6E0B7D1C-52A4-4F6B-9B1E-3C8D0A7F41D2}
AppName=Djinn
AppVersion={#Version}
AppPublisher=Djinn
AppPublisherURL=https://github.com/IDjinn/djinn-lang-v3
AppSupportURL=https://github.com/IDjinn/djinn-lang-v3/issues
DefaultDirName={localappdata}\Djinn
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=djinn-{#Tag}-windows-x86_64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
UninstallDisplayName=Djinn {#Version}
UsePreviousTasks=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full installation (with the UI framework and the Vulkan renderer)"
Name: "compact"; Description: "Compiler, standard library and runtime only"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "core"; Description: "Djinn compiler, standard library and runtime"; Types: full compact custom; Flags: fixed
Name: "ui"; Description: "UI framework libraries (ui, ui_macros and the Windows host, drawn by a software rasterizer)"; Types: full
Name: "ui\vulkan"; Description: "Vulkan renderer for the UI (GPU drawing: vulkan and spirv libraries, vulkan-1 import library)"; Types: full
Name: "android"; Description: "Android target (libraries for arm64-v8a and x86_64, build and APK tools; needs the Android SDK and NDK)"; Types: full

[Tasks]
Name: "extension"; Description: "Install the Visual Studio Code extension (language server, highlighting, build, debug)"; GroupDescription: "Integration:"; Check: CodeFound
Name: "autoupdate"; Description: "Keep Djinn up to date (checks every 6 hours)"; GroupDescription: "Updates:"
Name: "addtopath"; Description: "Add Djinn to the PATH"; GroupDescription: "Environment:"

[Files]
Source: "{#Source}\*"; Excludes: "optional\*"; DestDir: "{app}\versions\{#Tag}"; Components: core; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Source}\optional\ui\*"; DestDir: "{app}\versions\{#Tag}"; Components: ui; Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist
Source: "{#Source}\optional\vulkan\*"; DestDir: "{app}\versions\{#Tag}"; Components: ui\vulkan; Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist
Source: "{#Source}\optional\android\*"; DestDir: "{app}\versions\{#Tag}"; Components: android; Flags: recursesubdirs createallsubdirs ignoreversion skipifsourcedoesntexist
Source: "..\install.ps1"; DestDir: "{app}\bin"; DestName: "djinn-setup.ps1"; Flags: ignoreversion
Source: "{#Vsix}"; DestDir: "{app}"; DestName: "djinn-lang.vsix"; Flags: ignoreversion

[UninstallDelete]
Type: filesandordirs; Name: "{app}\versions"
Type: filesandordirs; Name: "{app}\bin"
Type: files; Name: "{app}\djinn-lang.vsix"
Type: files; Name: "{app}\.extension"
Type: files; Name: "{app}\.components"
Type: files; Name: "{app}\update.log"

[Code]
const
  EnvKey = 'Environment';
  TaskName = 'Djinn Auto Update';

function FindCodeCli: String;
var
  Path: String;
begin
  Result := FileSearch('code.cmd', GetEnv('PATH'));
  if Result <> '' then exit;
  Path := ExpandConstant('{localappdata}\Programs\Microsoft VS Code\bin\code.cmd');
  if FileExists(Path) then begin Result := Path; exit; end;
  Path := ExpandConstant('{commonpf}\Microsoft VS Code\bin\code.cmd');
  if FileExists(Path) then begin Result := Path; exit; end;
  Result := FileSearch('code-insiders.cmd', GetEnv('PATH'));
  if Result <> '' then exit;
  Result := FileSearch('codium.cmd', GetEnv('PATH'));
end;

function CodeFound: Boolean;
begin
  Result := FindCodeCli <> '';
end;

procedure RunHidden(const Command: String);
var
  Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/c ' + Command, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure AddToPath(const Dir: String);
var
  Paths: String;
begin
  if not RegQueryStringValue(HKCU, EnvKey, 'Path', Paths) then
    Paths := '';
  if Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Paths) + ';') = 0 then
  begin
    if (Paths <> '') and (Paths[Length(Paths)] <> ';') then
      Paths := Paths + ';';
    RegWriteExpandStringValue(HKCU, EnvKey, 'Path', Paths + Dir);
  end;
end;

procedure RemoveFromPath(const Dir: String);
var
  Paths: String;
begin
  if not RegQueryStringValue(HKCU, EnvKey, 'Path', Paths) then
    exit;
  Paths := ';' + Paths + ';';
  StringChangeEx(Paths, ';' + Dir + ';', ';', True);
  if Copy(Paths, 1, 1) = ';' then
    Delete(Paths, 1, 1);
  if (Paths <> '') and (Paths[Length(Paths)] = ';') then
    Delete(Paths, Length(Paths), 1);
  RegWriteExpandStringValue(HKCU, EnvKey, 'Path', Paths);
end;

procedure SwitchCurrent;
var
  Link, Target: String;
begin
  Link := ExpandConstant('{app}\current');
  Target := ExpandConstant('{app}\versions\{#Tag}');
  RunHidden('rmdir "' + Link + '"');
  RunHidden('mklink /J "' + Link + '" "' + Target + '"');
end;

procedure RegisterUpdateTask;
var
  Script, Action: String;
begin
  Script := ExpandConstant('{app}\bin\djinn-setup.ps1');
  Action := 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + Script +
    '\" -Mode update -Prefix \"' + ExpandConstant('{app}') + '\" -Quiet';
  RunHidden('schtasks /Create /TN "' + TaskName + '" /TR "' + Action + '" /SC HOURLY /MO 6 /F');
end;

// The updater (djinn-setup.ps1) reads this file to keep the same optional components on every update.
procedure SaveComponents;
var
  Text: String;
begin
  Text := '';
  if WizardIsComponentSelected('ui') then Text := Text + 'ui' + #13#10;
  if WizardIsComponentSelected('ui\vulkan') then Text := Text + 'vulkan' + #13#10;
  if WizardIsComponentSelected('android') then Text := Text + 'android' + #13#10;
  SaveStringToFile(ExpandConstant('{app}\.components'), Text, False);
end;

procedure InstallExtension;
var
  Cli: String;
begin
  Cli := FindCodeCli;
  if Cli = '' then exit;
  RunHidden('""' + Cli + '" --install-extension "' + ExpandConstant('{app}\djinn-lang.vsix') + '" --force"');
  SaveStringToFile(ExpandConstant('{app}\.extension'), '1', False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then
    exit;
  SwitchCurrent;
  SaveComponents;
  RegWriteStringValue(HKCU, EnvKey, 'DJINN_HOME', ExpandConstant('{app}'));
  if WizardIsTaskSelected('addtopath') then
  begin
    AddToPath(ExpandConstant('{app}\current\bin'));
    AddToPath(ExpandConstant('{app}\bin'));
  end;
  if WizardIsTaskSelected('autoupdate') then
    RegisterUpdateTask;
  if WizardIsTaskSelected('extension') then
    InstallExtension;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Cli: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    RunHidden('schtasks /Delete /TN "' + TaskName + '" /F');
    // the junction must go first, so that removing the install folder never follows it
    RunHidden('rmdir "' + ExpandConstant('{app}\current') + '"');
    Cli := FindCodeCli;
    if (Cli <> '') and FileExists(ExpandConstant('{app}\.extension')) then
      RunHidden('""' + Cli + '" --uninstall-extension djinn.djinn-lang"');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    RemoveFromPath(ExpandConstant('{app}\current\bin'));
    RemoveFromPath(ExpandConstant('{app}\bin'));
    RegDeleteValue(HKCU, EnvKey, 'DJINN_HOME');
  end;
end;
