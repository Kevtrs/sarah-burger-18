@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo  INSTALLATION SARAH BURGER - PANNEAU LED
echo ================================================

set "PYTHON_CMD=python"
python --version >nul 2>&1
if errorlevel 1 (
  py -3 --version >nul 2>&1
  if errorlevel 1 (
    echo Python est introuvable.
    echo Installe Python depuis https://www.python.org/downloads/windows/
    echo Coche "Add python.exe to PATH", puis relance INSTALLER.bat.
    pause
    exit /b 1
  )
  set "PYTHON_CMD=py -3"
)

%PYTHON_CMD% --version

if not exist .venv (
  echo Creation de l'environnement Python local...
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 (
    echo Impossible de creer .venv.
    pause
    exit /b 1
  )
)

set "VENV_PY=%CD%\.venv\Scripts\python.exe"
"%VENV_PY%" -m pip install --upgrade pip
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Installation des dependances impossible.
  pause
  exit /b 1
)

"%VENV_PY%" -c "import pypixelcolor; from pypixelcolor import Client; print('pypixelcolor OK')"
if errorlevel 1 (
  echo pypixelcolor ne s'importe pas correctement.
  pause
  exit /b 1
)

if not exist config.json copy /Y config.example.json config.json >nul
if not exist assets mkdir assets

echo.
echo Installation terminee.
echo 1. Place service-account.json dans ce dossier.
echo 2. Verifie config.json.
echo 3. Double-clique sur TESTER.bat puis LANCER.bat.
pause
