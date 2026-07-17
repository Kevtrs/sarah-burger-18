@echo off
setlocal
cd /d "%~dp0"
title Sarah Burger - Test panneau LED

if not exist ".venv\Scripts\python.exe" (
  echo Environnement Python absent. Lance d'abord INSTALLER.bat.
  pause
  exit /b 1
)

if not exist "config.json" (
  echo config.json absent. Lance INSTALLER.bat puis verifie la configuration.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" bridge.py --test 27 ready

echo.
echo Test termine.
pause
