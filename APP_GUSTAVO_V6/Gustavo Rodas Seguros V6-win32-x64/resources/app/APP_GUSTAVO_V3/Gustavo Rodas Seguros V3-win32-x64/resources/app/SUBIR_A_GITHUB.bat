@echo off
setlocal enabledelayedexpansion
echo ===================================================
echo CONFIGURANDO Y SUBIENDO A GITHUB (FIX IDENTIDAD)
echo ===================================================
echo.

if exist .git (
    echo [1/4] Limpiando configuracion previa...
    rmdir /s /q .git
)

echo.
echo [1/4] Inicializando repositorio...
git init
git config core.longpaths true
git config user.email "grodas@jylbrokers.com.ar"
git config user.name "Gustavo Rodas"
git branch -M main

echo.
echo [2/4] Preparando archivos...
git add .
git commit -m "Add scheduled email reports and 24/7 cloud robot"

echo.
echo [3/4] Datos de GitHub...
echo.
echo 1. Anda a tu repo en GitHub y copia EL LINK (ej: https://github.com/usuario/repo.git)
set /p REPO_LINK="Pegua el LINK aca: "

echo.
echo 2. El nombre de tu USUARIO de GitHub (grodas82-web)
set /p GH_USER="Escribi tu USUARIO: "

echo.
echo 3. Tu TOKEN o LLAVE (el codigo ghp_... o github_pat_...)
set /p GH_TOKEN="Pega tu TOKEN aca: "

REM Limpiar el link por si pego el comando entero
set "CLEAN_LINK=%REPO_LINK:git remote add origin =%"
set "CLEAN_LINK=%CLEAN_LINK: =%"

REM Extraer el dominio y el path del repo (quitando https://github.com/)
set "REPO_PATH=%CLEAN_LINK:https://github.com/=%"

REM Construir URL con autenticacion integrada
set "AUTH_URL=https://%GH_USER%:%GH_TOKEN%@github.com/%REPO_PATH%"

echo.
echo [4/4] Intentando conectar y subir...
git remote add origin %AUTH_URL%
git push -f -u origin main

echo.
echo ===================================================
echo PROCESO TERMINADO! Revisa tu GitHub.
echo ===================================================
pause
