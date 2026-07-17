@echo off
setlocal
cd /d "%~dp0"
title Sarah Burger - Panneau LED

if not exist ".venv\Scripts\python.exe" (
  echo Environnement Python absent. Lance d'abord INSTALLER.bat.
  pause
  exit /b 1
)

if not exist "config.json" (
  echo config.json absent. Lance INSTALLER.bat puis remplis la configuration.
  pause
  exit /b 1
)

if not exist "service-account.json" (
  echo service-account.json absent.
  echo Le bridge ne peut pas lire Firebase sans ce fichier local.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $svc = Get-Service bthserv -ErrorAction Stop; if ($svc.Status -eq 'Running') { exit 0 } exit 2 } catch { exit 3 }"
if errorlevel 1 (
  echo Attention: le service Bluetooth Windows ne semble pas actif.
  echo Active le Bluetooth avant de continuer.
  pause
)

".venv\Scripts\python.exe" bridge.py

echo.
echo Le pont LED s'est arrete.
pause
