# Cargo runner para pruebas unitarias en Windows (Tauri v2 + Common Controls v6).
# Evita STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) al cargar TaskDialogIndirect en comctl32.dll v6.
$ErrorActionPreference = 'Continue'

if ($args.Length -lt 1) {
    Write-Error 'No se proporcionó el ejecutable de pruebas.'
    exit 1
}

$ExePath = $args[0]
if (Test-Path -LiteralPath $ExePath) {
    $ExePath = (Resolve-Path -LiteralPath $ExePath).Path
}

$ExeArgs = @()
if ($args.Length -gt 1) {
    $ExeArgs = $args[1..($args.Length - 1)]
}

$ManifestPath = Join-Path $PSScriptRoot 'comctl-v6.xml'

if (Test-Path -LiteralPath $ManifestPath) {
    $MtCmd = Get-Command 'mt.exe' -ErrorAction SilentlyContinue
    $MtExe = if ($MtCmd) { $MtCmd.Source } else { $null }

    if (-not $MtExe) {
        $KitsRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
        if (Test-Path -LiteralPath $KitsRoot) {
            $FoundMt = Get-ChildItem -Path $KitsRoot -Filter 'mt.exe' -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\x64\\mt\.exe$' } |
                Sort-Object FullName -Descending |
                Select-Object -First 1
            if ($FoundMt) {
                $MtExe = $FoundMt.FullName
            }
        }
    }

    $Embedded = $false
    if ($MtExe) {
        $global:LASTEXITCODE = 0
        & $MtExe -nologo -manifest $ManifestPath "-outputresource:$ExePath;#1" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $Embedded = $true
        }
    }

    if (-not $Embedded) {
        Copy-Item -LiteralPath $ManifestPath -Destination "$ExePath.manifest" -Force
    }
}

$global:LASTEXITCODE = 0
& $ExePath @ExeArgs
exit $LASTEXITCODE
