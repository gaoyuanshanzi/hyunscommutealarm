# 🚀 Hyun's Commute Alarm (hyunscommutealarm)
## 위치 기반 대중교통 하차 알람 웹 애플리케이션

스마트폰 모바일 브라우저를 통해 대중교통(지하철, 버스 등) 이동 중 사용자가 수동으로 설정한 목적지와 도달 반경(m/km)에 접근하면 알람을 울려주는 Geofencing 기반의 웹 애플리케이션입니다.

---

## 📁 프로젝트 파일 구조

```
D:\antigravitycommutealarm\
├── index.html          # 메인 HTML 구조 (SPA 및 Leaflet/폰트 CDN 연동)
├── style.css           # 모바일 퍼스트 반응형 스타일 (다크/글래스모피즘 테마)
├── app.js              # 핵심 로직 (Leaflet 지도, Nominatim 지오코딩, GPS 위치 추적, Wake Lock)
├── alarm.js            # Web Audio API 기반 비프/알람 오디오 엔진
├── manifest.json       # PWA 홈 화면 추가 및 전체화면 실행 설정
├── vercel.json         # Vercel SPA 라우팅 및 보안 헤더 설정
├── DEPLOY_GUIDE.md     # GitHub 및 Vercel 배포 가이드
└── icons/
    └── icon.svg        # PWA 및 브라우저 아이콘
```

---

## ✨ 핵심 기능 요약

1. **사용자 수동 목적지 설정 & 글로벌 지오코딩**
   - 텍스트 입력창을 통한 글로벌 주소/지명 검색 (OpenStreetMap Nominatim API 연동).
   - 지도 화면을 직접 터치하여 원하는 위치를 목적지로 지정 (역지오코딩 지원).

2. **도달 반경(Circle) 수동 조절**
   - 슬라이더(`range`) 및 숫자 직접 입력(`m`/`km` 단위 지원).
   - `300m`, `500m`, `1km`, `2km` 빠른 프리셋 버튼 제공.
   - 지도상에 목적지를 중심으로 실시간 동적 반경 원(Circle) 표시.

3. **고정밀 GPS 추적 & Haversine 거리 계산**
   - `navigator.geolocation.watchPosition` 고정밀 모드로 실시간 현재 위치 추적.
   - Haversine 공식을 사용해 목적지까지의 직선거리를 미터 단위로 실시간 계산.

4. **Web Audio API 기반 알람 및 브라우저 Autoplay 대응**
   - 별도 mp3 파일 다운로드 없이 브라우저 오디오 오실레이터로 경고음 생성.
   - '알람 감시 시작' 버튼 클릭 시 `AudioContext`를 미리 활성화(Resume)하여 모바일 브라우저의 오디오 자동재생 제한을 완벽하게 우회.

5. **수동 알람 제어 및 완벽한 해제 프로세스**
   - 목적지 반경 내 진입 시 화면 전체에 붉은색 경고 팝업 및 반복 알람 발동.
   - 화면 중앙 대형 **[알람 끄기 (확인)]** 버튼 클릭 전까지 알람 지속 재생.
   - 버튼 클릭 시: **오디오 중단 → 팝업 닫기 → GPS 위치 추적(watchPosition) 종료 → Screen Wake Lock 해제**.
   - 사용자가 원할 때 언제든지 **[감시 중단 (OFF)]** 가능.

6. **모바일 최적화**
   - Screen Wake Lock API 적용으로 이동 중 화면 꺼짐 방지.

---

## 🛠️ 로컬 실행 방법

별도의 복잡한 빌드 과정 없이 정적 웹 서버(또는 Live Server)로 바로 실행할 수 있습니다.

```powershell
# VS Code Live Server 확장을 사용하거나 npx serve 실행:
npx -y serve .
```
브라우저에서 `http://localhost:3000` 접속 후 위치 권한을 허용하면 즉시 동작합니다.
