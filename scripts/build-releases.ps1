<#
.SYNOPSIS
    Empaquetado dual de producción para DiskVault Clean (Windows x64):
    1) Instalador NSIS (.exe)
    2) Versión Portable (.zip) con portable.flag y guía en español
    3) Archivo SHA256SUMS.txt con hashes de integridad

.PARAMETER SkipTests
    Omite la ejecución previa de `npx tsc --noEmit` y `cargo test` para iteraciones rápidas.
    Por defecto ejecuta toda la batería de pruebas y aborta ante cualquier fallo.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\build-releases.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\build-releases.ps1 -SkipTests
#>

[CmdletBinding()]
param(
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-FailAndExit {
    param([string]$Message)
    Write-Host "`n[ERROR] $Message" -ForegroundColor Red
    exit 1
}

function Assert-ToolAvailable {
    param([string]$ToolName)
    if (-not (Get-Command $ToolName -ErrorAction SilentlyContinue)) {
        Write-FailAndExit "No se encontró la herramienta requerida '$ToolName' en el PATH. Instálala antes de compilar."
    }
}

# Ubicar raíz del repositorio (directorio padre de /scripts)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$TauriDir = Join-Path $RepoRoot 'src-tauri'
$TauriConfPath = Join-Path $TauriDir 'tauri.conf.json'
$ReleaseDir = Join-Path $RepoRoot 'release'

Push-Location $RepoRoot
try {
    Write-Step 'Validando entorno y herramientas requeridas'
    Assert-ToolAvailable 'node'
    Assert-ToolAvailable 'npm'
    Assert-ToolAvailable 'cargo'
    Assert-ToolAvailable 'rustc'

    if (-not (Test-Path $TauriConfPath)) {
        Write-FailAndExit "No se encontró '$TauriConfPath'."
    }

    # Leer versión real desde src-tauri/tauri.conf.json
    $TauriConfig = Get-Content -Path $TauriConfPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = [string]$TauriConfig.version
    if ([string]::IsNullOrWhiteSpace($Version)) {
        Write-FailAndExit "No se pudo leer la versión desde '$TauriConfPath'."
    }
    Write-Success "Versión detectada: v$Version (ProductName: $($TauriConfig.productName))"

    # Validación de tipos y pruebas unitarias (a menos que se pase -SkipTests)
    if (-not $SkipTests) {
        Write-Step 'Ejecutando verificación estricta de TypeScript (npx tsc --noEmit)'
        & npx tsc --noEmit
        if ($LASTEXITCODE -ne 0) {
            Write-FailAndExit 'Falló la verificación de tipos de TypeScript (npx tsc --noEmit). Corrige los errores antes de empaquetar.'
        }
        Write-Success 'TypeScript sin errores'

        Write-Step 'Ejecutando suite completa de pruebas unitarias de Rust (cargo test)'
        Push-Location $TauriDir
        try {
            & cargo test
            if ($LASTEXITCODE -ne 0) {
                Write-FailAndExit 'Fallaron una o más pruebas unitarias en cargo test. Empaquetado cancelado.'
            }
        } finally {
            Pop-Location
        }
        Write-Success 'Todas las pruebas de Rust pasaron en verde'
    } else {
        Write-Host "`n[AVISO] Se omitieron pruebas previas por parámetro -SkipTests." -ForegroundColor Yellow
    }

    # Compilación Release Tauri v2 (genera binario release + instalador NSIS)
    Write-Step 'Compilando DiskVault Clean en modo Release (npm run tauri build)'
    & npm run tauri build
    if ($LASTEXITCODE -ne 0) {
        Write-FailAndExit 'Falló la compilación de producción (npm run tauri build).'
    }
    Write-Success 'Compilación Release completada'

    # Preparar carpeta release/ limpia
    Write-Step 'Ensamblando artefactos finales en release/'
    if (Test-Path $ReleaseDir) {
        Remove-Item -Path $ReleaseDir -Recurse -Force
    }
    New-Item -Path $ReleaseDir -ItemType Directory | Out-Null

    # 1) Localizar dinámicamente el instalador NSIS generado
    $NsisBundleDir = Join-Path $TauriDir 'target\release\bundle\nsis'
    $SetupExe = Get-ChildItem -Path $NsisBundleDir -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $SetupExe) {
        Write-FailAndExit "No se encontró el instalador NSIS (*-setup.exe) en '$NsisBundleDir'."
    }

    $FinalSetupName = "DiskVaultClean_v${Version}_Setup_x64.exe"
    $FinalSetupPath = Join-Path $ReleaseDir $FinalSetupName
    Copy-Item -Path $SetupExe.FullName -Destination $FinalSetupPath -Force
    Write-Success "Instalador NSIS copiado: $FinalSetupName"

    # 2) Localizar dinámicamente el ejecutable principal release (.exe)
    $TargetReleaseDir = Join-Path $TauriDir 'target\release'
    $MainExe = Get-ChildItem -Path $TargetReleaseDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -notlike 'build-script-*' -and
            $_.Name -notlike '*-setup.exe' -and
            $_.Name -notlike 'uninstall*.exe' -and
            $_.Name -notmatch '-[0-9a-f]{16}\.exe$'
        } |
        Sort-Object Length -Descending |
        Select-Object -First 1

    if (-not $MainExe) {
        Write-FailAndExit "No se encontró el ejecutable principal release (.exe) en '$TargetReleaseDir'."
    }
    Write-Success "Ejecutable principal localizado: $($MainExe.Name)"

    # Ensamblar carpeta temporal de staging para versión Portable
    $PortableStagingDir = Join-Path $ReleaseDir 'DiskVaultClean_Portable'
    New-Item -Path $PortableStagingDir -ItemType Directory | Out-Null

    $PortableExePath = Join-Path $PortableStagingDir 'DiskVaultClean.exe'
    Copy-Item -Path $MainExe.FullName -Destination $PortableExePath -Force

    # Crear portable.flag vacío junto al ejecutable
    $PortableFlagPath = Join-Path $PortableStagingDir 'portable.flag'
    New-Item -Path $PortableFlagPath -ItemType File -Force | Out-Null

    # Crear LEEME_PORTABLE.txt en español claro (UTF-8)
    $ReadmeContent = @"
========================================================================
  DiskVault Clean v$Version — Edición Portable (Windows x64)
========================================================================

Gracias por usar DiskVault Clean en su formato 100% Portable.

1. CÓMO EJECUTAR SIN INSTALAR
   - Descomprime TODO el contenido de este archivo .zip en la carpeta
     que prefieras (por ejemplo: D:\Herramientas\DiskVaultClean\ o
     en una memoria USB).
   - Ejecuta directamente "DiskVaultClean.exe". No requiere instalador.
   - Mantén siempre el archivo vacío "portable.flag" en la misma carpeta
     que "DiskVaultClean.exe": es el indicador que activa el Modo Portable.

2. AISLAMIENTO TOTAL DE DATOS (CERO REGISTRO DE WINDOWS)
   - Toda tu configuración, destinos NAS guardados, base de datos SQLite
     y registro de actividad se guardan únicamente en la subcarpeta local:
       .\data\diskvault.db
       .\data\logs\
   - Esta edición NO escribe en %APPDATA% ni crea entradas en el Registro
     de Windows (el inicio automático con Windows se mantiene bloqueado).

3. CÓMO ACTUALIZAR SIN PERDER TUS DATOS
   - Cuando descargues una versión nueva de DiskVault Clean Portable,
     descomprímela y copia tu carpeta ".\data\" anterior junto al nuevo
     "DiskVaultClean.exe". Conservarás todos tus destinos NAS, ajustes
     e historial de actividad.

4. REQUISITOS DEL SISTEMA
   - Windows 10 (versión 1903 o superior) o Windows 11 (arquitectura x64).
   - Microsoft Edge WebView2 Runtime (ya viene incluido por defecto en
     Windows 11 y en equipos Windows 10 actualizados; si faltara, puedes
     descargarlo gratuitamente desde la web oficial de Microsoft).

5. PERMISOS DE ADMINISTRADOR (OPCIONAL BAJO DEMANDA)
   - Puedes usar la app normalmente sin privilegios elevados.
   - Para funciones avanzadas (limpiar caché de Windows Update, purgar
     Standby List de RAM o crear enlaces NTFS en rutas protegidas),
     pulsa el botón "Activar Modo Administrador" dentro de la app.
"@

    $ReadmePath = Join-Path $PortableStagingDir 'LEEME_PORTABLE.txt'
    Set-Content -Path $ReadmePath -Value $ReadmeContent -Encoding UTF8

    # Comprimir carpeta Portable en .zip
    $FinalPortableZipName = "DiskVaultClean_v${Version}_Portable_x64.zip"
    $FinalPortableZipPath = Join-Path $ReleaseDir $FinalPortableZipName
    Compress-Archive -Path (Join-Path $PortableStagingDir '*') -DestinationPath $FinalPortableZipPath -CompressionLevel Optimal -Force
    Write-Success "Paquete Portable comprimido: $FinalPortableZipName"

    # Limpiar carpeta temporal intermedia de staging
    Remove-Item -Path $PortableStagingDir -Recurse -Force

    # 3) Calcular hashes SHA-256 y generar SHA256SUMS.txt
    Write-Step 'Generando hashes de integridad SHA-256 (SHA256SUMS.txt)'
    $Deliverables = @($FinalSetupPath, $FinalPortableZipPath)
    $ChecksumLines = @()
    $SummaryRows = @()

    foreach ($ArtifactPath in $Deliverables) {
        $HashObj = Get-FileHash -Path $ArtifactPath -Algorithm SHA256
        $FileInfo = Get-Item -Path $ArtifactPath
        $SizeMb = [math]::Round($FileInfo.Length / 1MB, 2)
        $ChecksumLines += "$($HashObj.Hash.ToLowerInvariant())  $($FileInfo.Name)"
        $SummaryRows += [PSCustomObject]@{
            Archivo   = $FileInfo.Name
            'Tamaño'  = "$SizeMb MB"
            Ruta      = $FileInfo.FullName
        }
    }

    $ChecksumFilePath = Join-Path $ReleaseDir 'SHA256SUMS.txt'
    Set-Content -Path $ChecksumFilePath -Value ($ChecksumLines -join "`r`n") -Encoding UTF8
    Write-Success "Checksums guardados en: $ChecksumFilePath"

    Write-Step 'Empaquetado dual completado con éxito'
    $SummaryRows | Format-Table -AutoSize
}
finally {
    Pop-Location
}
