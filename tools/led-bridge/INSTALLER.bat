@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo  INSTALLATION SARAH BURGER - PANNEAU LED
echo ================================================

python --version >nul 2>&1
if errorlevel 1 (
  echo Python est introuvable. Installe Python puis relance ce fichier.
  pause
  exit /b 1
)

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if not exist config.json copy /Y config.example.json config.json >nul

echo.
echo Installation terminee.
echo Tu peux maintenant double-cliquer sur LANCER.bat.
pause
