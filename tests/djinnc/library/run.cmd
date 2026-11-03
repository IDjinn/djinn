@echo off
setlocal
set ROOT=%~dp0..\..\..
set PATH=%PATH%;C:\Program Files\LLVM\bin
if "%DJINNC%"=="" set DJINNC=%ROOT%\djinnc\build\djinnc.exe
set OUT=%ROOT%\build\lib
if not exist "%OUT%" mkdir "%OUT%"

echo == build library
"%DJINNC%" "%~dp0mathlib.djinn" --library -o "%OUT%\mathlib.djlib" --runtime-dir "%ROOT%\runtime" || exit /b 1

echo == inspect library
"%DJINNC%" --inspect-lib "%OUT%\mathlib.djlib" || exit /b 1

echo == build app against library
"%DJINNC%" "%~dp0app.djinn" --lib "%OUT%\mathlib.djlib" -o "%OUT%\app.exe" --runtime-dir "%ROOT%\runtime" || exit /b 1

echo == run app (expected exit code 35)
"%OUT%\app.exe"
echo exit code: %ERRORLEVEL%
