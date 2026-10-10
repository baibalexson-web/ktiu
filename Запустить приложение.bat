@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto directory_error
if not exist "server.mjs" goto unpack_error
if not exist "data\manifest.json" goto unpack_error
if not exist "vendor\pdfjs\pdf.mjs" goto unpack_error
where node >nul 2>nul
if errorlevel 1 goto node_error
node server.mjs --open
if errorlevel 1 goto launch_error
exit /b 0

:directory_error
echo Could not open the application folder.
goto failed
:unpack_error
echo Extract the entire ZIP archive before running this file.
goto failed
:node_error
echo Install Node.js 24 LTS or newer, then run this file again.
echo Official download: https://nodejs.org/en/download
start "" "https://nodejs.org/en/download"
goto failed
:launch_error
echo The application could not start. Read the error above.
goto failed
:failed
pause
exit /b 1
