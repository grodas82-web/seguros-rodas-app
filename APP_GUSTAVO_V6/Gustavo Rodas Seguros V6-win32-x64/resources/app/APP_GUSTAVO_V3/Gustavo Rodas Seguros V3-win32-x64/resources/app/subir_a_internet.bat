@echo off
set LOGFILE=despliegue_final_log.txt
echo ========================================== > %LOGFILE%
echo  Iniciando Subida (FINAL): %date% %time% >> %LOGFILE%
echo ========================================== >> %LOGFILE%

echo.
echo [1/2] Construyendo la app...
call npm run build >> %LOGFILE% 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] La construccion fallo.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/2] Desplegando a Vercel...
echo (Usando configuracion vercel.json para saltar build remoto)

REM Desplegamos desde la raiz usando vercel.json para configurar el proyecto
echo [INFO] Iniciando npx vercel...
call npx -y vercel deploy . --prod --yes
set DEPLOY_ERROR=%errorlevel%

if %DEPLOY_ERROR% neq 0 (
    echo.
    echo [ERROR] Vercel devolvio un error (Codigo: %DEPLOY_ERROR%).
    echo.
    echo Posibles causas:
    echo 1. No estas logueado en Vercel (corre 'npx vercel login' en una terminal).
    echo 2. Problemas de conexion.
    echo.
    pause
) else (
    echo.
    echo ==========================================
    echo PROCESO TERMINADO CON EXITO!
    echo ==========================================
    echo.
    echo El link aparecera en las ultimas lineas del log.
    echo.
    type %LOGFILE%
)

echo.
echo Presiona cualquier tecla para cerrar...
pause > nul
