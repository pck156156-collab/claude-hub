# 게임 개발 도구 설치 스크립트 (Windows, winget 사용)
# 실행: PowerShell에서
#   powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
# 단계만 골라서 설치하려면: .\setup-windows.ps1 -Step 1

param(
    [int]$Step = 0   # 0 = 전체, 1~4 = 해당 단계만
)

$ErrorActionPreference = "Continue"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget이 없습니다. Microsoft Store에서 '앱 설치 관리자(App Installer)'를 설치한 뒤 다시 실행하세요." -ForegroundColor Red
    exit 1
}

$failed = @()

function Install-App($id, $name, $url) {
    Write-Host "`n>> $name 설치 중..." -ForegroundColor Cyan
    winget install -e --id $id --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   $name 자동 설치 실패 (이미 설치됐을 수도 있음). 수동 설치: $url" -ForegroundColor Yellow
        $script:failed += "$name -> $url"
    }
}

# 1단계: 엔진 + 효과음/에셋은 웹
if ($Step -eq 0 -or $Step -eq 1) {
    Write-Host "`n=== 1단계: 첫 2D 게임 (Godot) ===" -ForegroundColor Green
    Install-App "GodotEngine.GodotEngine" "Godot" "https://godotengine.org/download"
}

# 2단계: 3D 입문
if ($Step -eq 0 -or $Step -eq 2) {
    Write-Host "`n=== 2단계: 3D 입문 (Blender) ===" -ForegroundColor Green
    Install-App "BlenderFoundation.Blender" "Blender" "https://www.blender.org/download/"
}

# 3단계: 직접 제작
if ($Step -eq 0 -or $Step -eq 3) {
    Write-Host "`n=== 3단계: 직접 제작 (Krita, LibreSprite, Tiled) ===" -ForegroundColor Green
    Install-App "KDE.Krita" "Krita" "https://krita.org/en/download/"
    Install-App "LibreSprite.LibreSprite" "LibreSprite" "https://libresprite.github.io/"
    Install-App "Tiled.Tiled" "Tiled" "https://www.mapeditor.org/"
}

# 4단계: AI 활용은 설치 없음 (Claude에 연결된 Higgsfield / Adobe 사용)

# 작업 폴더 만들기
$root = Join-Path $HOME "GameDev"
foreach ($d in @("projects", "assets\kenney", "assets\quaternius", "assets\mixamo", "assets\my-art", "assets\audio")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null
}
Write-Host "`n작업 폴더 준비됨: $root" -ForegroundColor Green

if ($failed.Count -gt 0) {
    Write-Host "`n수동 설치가 필요한 항목:" -ForegroundColor Yellow
    $failed | ForEach-Object { Write-Host "  - $_" }
}
Write-Host "`n다음: game-dev-setup/README.md 의 체크리스트를 따라가세요."
