# 🌐 GitHub 연동 및 Vercel 배포 완벽 가이드
### 프로젝트명 / 도메인: `hyunscommutealarm`

---

## 1단계: Git 저장소 초기화 및 GitHub 업로드

### 1-1. GitHub에서 새 저장소(Repository) 생성
1. [GitHub](https://github.com)에 로그인합니다.
2. 우측 상단 `+` 버튼 클릭 → **New repository** 선택.
3. **Repository name**에 `hyunscommutealarm` 입력.
4. **Public** 또는 **Private** 선택 후 **Create repository** 클릭.
5. 생성된 저장소의 URL을 복사합니다. (예: `https://github.com/YOUR_USERNAME/hyunscommutealarm.git`)

### 1-2. 로컬 터미널(PowerShell)에서 Git 명령어 실행
VS Code 터미널 또는 PowerShell에서 다음 명령어를 순서대로 실행합니다:

```powershell
# 1. 프로젝트 폴더로 이동 (이미 해당 폴더인 경우 생략)
cd D:\antigravitycommutealarm

# 2. Git 저장소 초기화
git init

# 3. 모든 파일 스테이징
git add .

# 4. 첫 번째 커밋 생성
git commit -m "feat: Initial commit for Hyun's Commute Alarm web app"

# 5. 기본 브랜치를 main으로 설정
git branch -M main

# 6. GitHub 원격 저장소 연결 (본인의 GitHub 사용자명으로 변경)
git remote add origin https://github.com/YOUR_USERNAME/hyunscommutealarm.git

# 7. GitHub로 푸시 (Push)
git push -u origin main
```

---

## 2단계: Vercel 배포 (방법 A: 웹 콘솔 / 추천)

Vercel 웹 콘솔을 연결하면 GitHub에 코드를 푸시할 때마다 자동으로 배포(CI/CD)됩니다.

1. [Vercel](https://vercel.com)에 접속하여 GitHub 계정으로 로그인/가입합니다.
2. 대시보드에서 **[Add New...]** → **[Project]** 버튼을 클릭합니다.
3. **Import Git Repository** 목록에서 방금 푸시한 `hyunscommutealarm` 저장소를 찾아서 **[Import]**를 클릭합니다.
4. **Configure Project** 화면 설정:
   - **Project Name**: `hyunscommutealarm` (기본값으로 `https://hyunscommutealarm.vercel.app` 도메인이 생성됩니다.)
   - **Framework Preset**: `Other` (정적 HTML/JS 프로젝트이므로 별도 빌드 설정 불필요)
   - **Root Directory**: `./`
5. **[Deploy]** 버튼 클릭!
6. 약 10~20초 후 배포가 완료되며, 화면에 생성된 실제 서비스 URL(`https://hyunscommutealarm.vercel.app`)이 표시됩니다.

---

## 3단계: Vercel CLI로 바로 배포하기 (방법 B: 터미널 배포)

터미널에서 직접 배포를 진행하고 싶다면 Vercel CLI를 사용할 수 있습니다.

```powershell
# 1. Vercel CLI 설치 및 로그인 (최초 1회)
npx -y vercel login

# 2. 프로젝트 폴더에서 배포 실행
npx -y vercel --prod
```
- 프로젝트 이름 설정 프롬프트에서 `hyunscommutealarm`을 입력하시면 배포가 완료됩니다.

---

## 4단계: 모바일 실기기 사용 및 PWA 설치

1. 스마트폰(iPhone Safari / Android Chrome)에서 배포된 URL(`https://hyunscommutealarm.vercel.app`)에 접속합니다.
2. **위치 정보 접근 권한(GPS)** 팝업이 뜨면 **[허용]**을 누릅니다.
3. **홈 화면에 추가 (PWA)**:
   - **iOS Safari**: 브라우저 하단 공유 버튼(네모+화살표) → **[홈 화면에 추가]**
   - **Android Chrome**: 우측 상단 메뉴(점 3개) → **[홈 화면에 추가]** 또는 **[앱 설치]**
4. 홈 화면에 설치된 아이콘을 누르면 주소창 없는 깔끔한 전체 화면 앱 형태로 실행됩니다!
