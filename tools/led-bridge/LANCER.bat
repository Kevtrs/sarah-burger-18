@echo off
setlocal
cd /d "%~dp0"
title Sarah Burger - Panneau LED
python bridge.py

echo.
echo Le pont LED s'est arrete.
pause
