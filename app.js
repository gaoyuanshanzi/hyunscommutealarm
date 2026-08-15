/**
 * app.js — Geofencing Wake-up Alarm Core Application Logic
 * Leaflet.js, OpenStreetMap Nominatim, Geolocation API, Screen Wake Lock API, Audio Alarm
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. 상태 관리 객체 (State)
  const state = {
    destination: null,        // { lat, lng, name }
    currentPosition: null,    // { lat, lng, accuracy }
    radiusMeters: 500,        // 기본 알람 반경 500m
    isWatching: false,        // 감시 동작 여부
    isAlarmRinging: false,    // 알람 작동 중 여부
    watchId: null,            // geolocation watchPosition ID
    wakeLock: null,           // Screen Wake Lock 센티넬
    searchDebounceTimer: null
  };

  // 2. 오디오 알람 인스턴스
  const alarm = new window.AlarmSystem();

  // 3. DOM 요소 참조
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const destSearchInput = document.getElementById('destSearchInput');
  const btnSearch = document.getElementById('btnSearch');
  const searchResultsBox = document.getElementById('searchResultsBox');
  const destNameDisplay = document.getElementById('destNameDisplay');
  const destCoordDisplay = document.getElementById('destCoordDisplay');
  
  const radiusRange = document.getElementById('radiusRange');
  const radiusNumberInput = document.getElementById('radiusNumberInput');
  const radiusUnitSelect = document.getElementById('radiusUnitSelect');
  const radiusDisplay = document.getElementById('radiusDisplay');
  const chipButtons = document.querySelectorAll('.btn-chip');
  
  const liveDistanceDisplay = document.getElementById('liveDistanceDisplay');
  const gpsAccuracyDisplay = document.getElementById('gpsAccuracyDisplay');
  const btnToggleWatch = document.getElementById('btnToggleWatch');
  const btnMyPos = document.getElementById('btnMyPos');
  
  const alarmOverlay = document.getElementById('alarmOverlay');
  const alarmDestName = document.getElementById('alarmDestName');
  const alarmCurrentDist = document.getElementById('alarmCurrentDist');
  const btnDismissAlarm = document.getElementById('btnDismissAlarm');

  // 4. Leaflet 지도 초기화
  // 기본 좌표: 서울시청 (37.5665, 126.9780)
  const defaultCenter = [37.5665, 126.9780];
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(defaultCenter, 14);

  // OpenStreetMap 타일 레이어
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // 마커 & 서클 레이어 관리
  let destMarker = null;
  let destCircle = null;
  let currentPosMarker = null;
  let currentPosAccuracyCircle = null;

  // 마커 커스텀 아이콘
  const destIcon = L.divIcon({
    className: 'custom-dest-pin',
    html: `<div style="background-color:#ef4444; width:18px; height:18px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 0 10px rgba(239,68,68,0.8);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  const currentIcon = L.divIcon({
    className: 'custom-my-pin',
    html: `<div style="background-color:#00d4ff; width:16px; height:16px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 0 12px #00d4ff;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  // 5. Haversine 공식 거리 계산 (단위: 미터)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반지름 (m)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // 거리 포맷팅 헬퍼
  function formatDistance(meters) {
    if (meters === null || meters === undefined || isNaN(meters)) return '-';
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  }

  // 6. 목적지 설정 및 지도 갱신 함수
  function setDestination(lat, lng, name) {
    state.destination = { lat: parseFloat(lat), lng: parseFloat(lng), name: name || '선택한 목적지' };
    
    // UI 업데이트
    destNameDisplay.textContent = state.destination.name;
    destCoordDisplay.textContent = `위도: ${state.destination.lat.toFixed(5)}, 경도: ${state.destination.lng.toFixed(5)}`;
    
    // 마커 갱신
    if (destMarker) {
      destMarker.setLatLng([state.destination.lat, state.destination.lng]);
    } else {
      destMarker = L.marker([state.destination.lat, state.destination.lng], { icon: destIcon }).addTo(map);
    }
    
    // 반경 서클 갱신
    updateDestinationCircle();

    // 지도 중심 이동
    map.flyTo([state.destination.lat, state.destination.lng], Math.max(map.getZoom(), 15), {
      duration: 1
    });

    // 현재 위치가 있으면 거리 다시 계산
    if (state.currentPosition) {
      updateDistanceCheck();
    }

    validateCanStart();
  }

  // 목적지 반경 Circle 업데이트
  function updateDestinationCircle() {
    if (!state.destination) return;

    if (destCircle) {
      destCircle.setLatLng([state.destination.lat, state.destination.lng]);
      destCircle.setRadius(state.radiusMeters);
    } else {
      destCircle = L.circle([state.destination.lat, state.destination.lng], {
        radius: state.radiusMeters,
        color: '#00d4ff',
        fillColor: '#00d4ff',
        fillOpacity: 0.18,
        weight: 2,
        dashArray: '4, 6'
      }).addTo(map);
    }
  }

  // 반경 값 동기화 (Slider, Number Input, Display)
  function setRadiusValue(meters) {
    const val = Math.max(50, Math.min(10000, Math.round(meters)));
    state.radiusMeters = val;

    // 슬라이더 반영
    radiusRange.value = Math.min(val, 5000);
    radiusDisplay.textContent = formatDistance(val);

    // 수동 숫자 입력창 반영
    if (radiusUnitSelect.value === 'km') {
      radiusNumberInput.value = (val / 1000).toFixed(2);
    } else {
      radiusNumberInput.value = val;
    }

    // 칩 버튼 활성화 상태 업데이트
    chipButtons.forEach(btn => {
      const chipMeters = parseInt(btn.getAttribute('data-value'), 10);
      if (chipMeters === val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 지도 상 서클 실시간 업데이트
    updateDestinationCircle();

    // 거리 체크 재실행
    if (state.currentPosition && state.isWatching) {
      updateDistanceCheck();
    }
  }

  // 7. 슬라이더 & 숫자 입력 이벤트 리스너
  radiusRange.addEventListener('input', (e) => {
    setRadiusValue(parseInt(e.target.value, 10));
  });

  radiusNumberInput.addEventListener('input', () => {
    const rawVal = parseFloat(radiusNumberInput.value);
    if (!isNaN(rawVal) && rawVal > 0) {
      const inMeters = radiusUnitSelect.value === 'km' ? rawVal * 1000 : rawVal;
      setRadiusValue(inMeters);
    }
  });

  radiusUnitSelect.addEventListener('change', () => {
    if (radiusUnitSelect.value === 'km') {
      radiusNumberInput.value = (state.radiusMeters / 1000).toFixed(2);
      radiusNumberInput.step = '0.1';
    } else {
      radiusNumberInput.value = state.radiusMeters;
      radiusNumberInput.step = '50';
    }
  });

  chipButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.getAttribute('data-value'), 10);
      setRadiusValue(val);
    });
  });

  // 8. 스마트 지오코딩 엔진 (Nominatim + Photon + 한국어 키워드 자동 정제)
  
  // 한국어 자연어 검색어 정제 함수 (예: "역삼역앞" -> "역삼역", "강남역 2번출구" -> "강남역", "시청 주변" -> "시청")
  function cleanKoreanQuery(query) {
    let q = query.trim();
    // 1. 끝에 붙은 불용어/접미사 제거
    const suffixPattern = /(앞|뒤|옆|근처|주변|부근|사거리|삼거리|오거리|역앞)$/i;
    // 2. 출구 패턴 (예: "2번출구", "1번 출구" -> 제거)
    const exitPattern = /\s*\d+번\s*출구/i;

    const cleaned = q.replace(exitPattern, '').replace(suffixPattern, '').trim();
    return cleaned !== q ? cleaned : null;
  }

  async function fetchNominatim(q) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=6`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko,en' } });
      if (!res.ok) return [];
      const data = await res.json();
      return (data || []).map(item => ({
        lat: item.lat,
        lng: item.lon,
        title: item.display_name.split(',')[0],
        subtitle: item.display_name,
        source: 'osm'
      }));
    } catch (e) {
      console.warn('Nominatim error:', e);
      return [];
    }
  }

  async function fetchPhoton(q) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=ko&limit=6`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !data.features) return [];

      return data.features.map(f => {
        const props = f.properties;
        const coords = f.geometry.coordinates; // [lng, lat]
        const name = props.name || props.street || props.city || '알 수 없는 위치';
        const details = [
          props.country,
          props.state,
          props.city || props.county,
          props.district,
          props.street,
          props.housenumber
        ].filter(Boolean).join(' ');

        return {
          lat: coords[1],
          lng: coords[0],
          title: name,
          subtitle: details || name,
          source: 'photon'
        };
      });
    } catch (e) {
      console.warn('Photon error:', e);
      return [];
    }
  }

  async function searchLocation(query) {
    if (!query || query.trim().length < 2) {
      searchResultsBox.classList.remove('show');
      return;
    }

    const rawQuery = query.trim();
    const refinedQuery = cleanKoreanQuery(rawQuery);

    try {
      searchResultsBox.innerHTML = '<div style="padding:12px; font-size:0.8rem; color:#8e9eb5;">장소를 스마트하게 검색하는 중...</div>';
      searchResultsBox.classList.add('show');

      // 1) 원본 질의로 Nominatim + Photon 동시 조회
      let results = [];
      const [nomRaw, photonRaw] = await Promise.all([
        fetchNominatim(rawQuery),
        fetchPhoton(rawQuery)
      ]);

      results = [...nomRaw, ...photonRaw];

      // 2) 만약 검색 결과가 없거나 부족하고, 정제된 키워드(예: "역삼역앞" -> "역삼역")가 있으면 2차 검색
      if (results.length === 0 && refinedQuery && refinedQuery.length >= 2) {
        const [nomRefined, photonRefined] = await Promise.all([
          fetchNominatim(refinedQuery),
          fetchPhoton(refinedQuery)
        ]);
        results = [...nomRefined, ...photonRefined];
      }

      // 중복 좌표/이름 제거 (Deduplication)
      const uniqueResults = [];
      const seen = new Set();

      for (const item of results) {
        const key = `${parseFloat(item.lat).toFixed(3)}_${parseFloat(item.lng).toFixed(3)}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueResults.push(item);
        }
      }

      if (uniqueResults.length === 0) {
        searchResultsBox.innerHTML = `
          <div style="padding:14px; font-size:0.85rem; color:#f87171; text-align:center;">
            '${rawQuery}' 검색 결과가 없습니다.<br/>
            <span style="font-size:0.75rem; color:#8e9eb5; margin-top:4px; display:block;">
              Tip: 지도에서 원하는 위치를 직접 터치하셔도 지정됩니다.
            </span>
          </div>
        `;
        return;
      }

      searchResultsBox.innerHTML = '';
      uniqueResults.slice(0, 6).forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'search-item';

        itemDiv.innerHTML = `
          <strong>${item.title}</strong>
          <span class="search-item-sub">${item.subtitle}</span>
        `;

        itemDiv.addEventListener('click', () => {
          setDestination(item.lat, item.lng, `${item.title} (${item.subtitle})`);
          destSearchInput.value = item.title;
          searchResultsBox.classList.remove('show');
        });

        searchResultsBox.appendChild(itemDiv);
      });
    } catch (err) {
      console.error('Geocoding error:', err);
      searchResultsBox.innerHTML = '<div style="padding:12px; font-size:0.8rem; color:#ef4444;">검색 중 오류가 발생했습니다.</div>';
    }
  }

  // 검색 디바운스 및 버튼 클릭
  destSearchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => {
      searchLocation(e.target.value);
    }, 450);
  });

  destSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(state.searchDebounceTimer);
      searchLocation(destSearchInput.value);
    }
  });

  btnSearch.addEventListener('click', () => {
    searchLocation(destSearchInput.value);
  });

  // 검색창 바깥 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!destSearchInput.contains(e.target) && !searchResultsBox.contains(e.target)) {
      searchResultsBox.classList.remove('show');
    }
  });

  // 9. 지도 직접 클릭하여 목적지 지정 (Reverse Geocoding)
  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    setDestination(lat, lng, '지도에서 직접 선택한 위치');

    // Nominatim 역지오코딩 시도
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko,en' } });
      const data = await res.json();
      if (data && data.display_name) {
        setDestination(lat, lng, data.display_name);
        destSearchInput.value = data.display_name.split(',')[0];
      }
    } catch (err) {
      console.warn('Reverse geocoding failed:', err);
    }
  });

  // 10. 현재 위치 갱신 & 마커 표시
  function updateCurrentPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    state.currentPosition = { lat: latitude, lng: longitude, accuracy };

    gpsAccuracyDisplay.textContent = `±${Math.round(accuracy)} m`;

    if (currentPosMarker) {
      currentPosMarker.setLatLng([latitude, longitude]);
    } else {
      currentPosMarker = L.marker([latitude, longitude], { icon: currentIcon }).addTo(map);
    }

    if (currentPosAccuracyCircle) {
      currentPosAccuracyCircle.setLatLng([latitude, longitude]);
      currentPosAccuracyCircle.setRadius(accuracy);
    } else {
      currentPosAccuracyCircle = L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#00d4ff',
        fillColor: '#00d4ff',
        fillOpacity: 0.08,
        weight: 1
      }).addTo(map);
    }

    updateDistanceCheck();
  }

  // 내 위치로 지도 중심 이동 버튼
  btnMyPos.addEventListener('click', () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          updateCurrentPosition(pos);
          map.flyTo([pos.coords.latitude, pos.coords.longitude], 16);
        },
        (err) => {
          alert('현재 위치 정보를 가져올 수 없습니다: ' + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      alert('이 브라우저는 위치 정보를 지원하지 않습니다.');
    }
  });

  // 11. 거리 계산 및 알람 진입 판단
  function updateDistanceCheck() {
    if (!state.destination || !state.currentPosition) {
      liveDistanceDisplay.textContent = '-';
      return;
    }

    const dist = calculateDistance(
      state.currentPosition.lat,
      state.currentPosition.lng,
      state.destination.lat,
      state.destination.lng
    );

    liveDistanceDisplay.textContent = formatDistance(dist);

    // 감시 중이고, 반경 내에 도달했으며, 아직 알람이 울리지 않은 경우 알람 발동!
    if (state.isWatching && !state.isAlarmRinging && dist <= state.radiusMeters) {
      triggerAlarm(dist);
    }
  }

  // 12. Screen Wake Lock API (화면 꺼짐 방지)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        console.log('Screen Wake Lock 활성화됨');
      } catch (err) {
        console.warn('Wake Lock 요청 실패:', err.message);
      }
    }
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release().then(() => {
        state.wakeLock = null;
        console.log('Screen Wake Lock 해제됨');
      }).catch(e => console.warn(e));
    }
  }

  // 13. 알람 발동 (Alarm Trigger)
  async function triggerAlarm(currentDist) {
    state.isAlarmRinging = true;

    // 사운드 및 진동 재생
    await alarm.start();

    // 풀스크린 팝업 UI 표시
    alarmDestName.textContent = state.destination.name;
    alarmCurrentDist.textContent = `목적지까지 약 ${formatDistance(currentDist)} 남음 (설정 반경: ${formatDistance(state.radiusMeters)})`;
    alarmOverlay.classList.add('active');

    // 상태 표시줄 변경
    updateStatusUI('alert', '목적지 근접 알람 작동 중!');
  }

  // 14. 수동 [알람 끄기] 처리 프로세스
  function stopAndDismissAlarm() {
    // 1) 사운드 및 진동 즉시 중단
    alarm.stop();
    state.isAlarmRinging = false;

    // 2) 팝업 닫기
    alarmOverlay.classList.remove('active');

    // 3) GPS 위치 추적 종료
    stopWatching();
  }

  btnDismissAlarm.addEventListener('click', stopAndDismissAlarm);

  // 15. 감시 시작 / 중단 토글 로직
  async function startWatching() {
    if (!state.destination) {
      alert('먼저 목적지를 설정해 주세요.');
      return;
    }

    if (!navigator.geolocation) {
      alert('현재 브라우저에서 위치 서비스를 지원하지 않습니다.');
      return;
    }

    // 모바일 브라우저 오디오 자동재생(Autoplay) 정책 우회: 사용자 터치 시 미리 resume
    await alarm.prime();

    // 화면 꺼짐 방지 활성화
    await requestWakeLock();

    state.isWatching = true;
    updateStatusUI('active', '실시간 위치 감시 중');

    btnToggleWatch.textContent = '감시 중단 (OFF)';
    btnToggleWatch.className = 'main-action-btn stop-btn';

    // GPS 고정밀 실시간 추적 시작
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        updateCurrentPosition(pos);
      },
      (err) => {
        console.error('Geolocation watch error:', err);
        let msg = '위치 수신 오류가 발생했습니다.';
        if (err.code === 1) msg = '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.';
        else if (err.code === 2) msg = '위치 정보를 확인할 수 없습니다 (GPS 신호 약함).';
        else if (err.code === 3) msg = '위치 정보 요청 시간이 초과되었습니다.';
        
        statusText.textContent = msg;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000
      }
    );
  }

  function stopWatching() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }

    releaseWakeLock();

    state.isWatching = false;
    updateStatusUI('idle', '대기 중');

    btnToggleWatch.textContent = '알람 감시 시작 (ON)';
    btnToggleWatch.className = 'main-action-btn start-btn';
  }

  btnToggleWatch.addEventListener('click', () => {
    if (state.isWatching) {
      stopWatching();
    } else {
      startWatching();
    }
  });

  // 상태 배지 UI 변경 함수
  function updateStatusUI(type, text) {
    statusPill.className = `status-pill ${type}`;
    statusText.textContent = text;
  }

  // 시작 버튼 활성화 가능 여부 체크
  function validateCanStart() {
    if (state.destination) {
      btnToggleWatch.disabled = false;
    } else {
      btnToggleWatch.disabled = true;
    }
  }

  // 앱 로드 시 현재 위치 한 번 가져와서 지도 포커싱
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateCurrentPosition(pos);
        map.setView([pos.coords.latitude, pos.coords.longitude], 15);
      },
      (err) => {
        console.log('Initial location lookup optional fail:', err);
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }

  // 초기 상태 초기화
  setRadiusValue(500);
  validateCanStart();
});
