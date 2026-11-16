@echo off
setlocal EnableExtensions DisableDelayedExpansion
title MarginLink - Build latest ZIP

where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Windows PowerShell is required.
    if /i not "%~1"=="--no-pause" pause
    exit /b 1
)

rem Parse this block before pulling, in case Git updates this launcher too.
(
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-latest.ps1"
    if errorlevel 1 (
        echo.
        if /i not "%~1"=="--no-pause" pause
        exit /b 1
    ) else (
        echo.
        if /i not "%~1"=="--no-pause" pause
        exit /b 0
    )
)
