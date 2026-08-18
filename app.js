/**
 * app.js — Geofencing & Real-time Seoul Subway Commute Alarm
 * - GPS 거리 기반 알람 모드 (Haversine 공식, Leaflet.js, OpenStreetMap/Photon)
 * - 서울시 공공 API 기반 지하철 실시간 도착 알람 모드 (Seoul Open API)
 * - 유튜브 등 타 앱 실행 중 백그라운드 오버라이드 알람 (Web Notifications API, Audio Keep-Alive, Screen Wake Lock)
 */

document.addEventListener('DOMContentLoaded', () => {
  // 서울시 지하철 실시간 OpenAPI Key
  const SEOUL_SUBWAY_API_KEY = '484443435773616d31303964664b4464';

  // 1. 전역 상태 (State)
  const state = {
    mode: 'GPS',              // 'GPS' | 'SUBWAY'
    destination: null,        // { lat, lng, name, stationName }
    currentPosition: null,    // { lat, lng, accuracy }
    radiusMeters: 500,        // GPS 알람 반경 (기본 500m)
    subwayLine: 'ALL',        // 호선 필터 (ALL, 1002 등)
    subwayTrigger: '1',       // 알람 조건 ('1': 1정거장 전, '2': 2정거장 전, '0': 도착 즉시)
    isWatching: false,        // 감시 진행 여부
    isAlarmRinging: false,    // 알람 발동 중 여부
    watchId: null,            // GPS watchPosition ID
    subwayPollInterval: null, // 지하철 API 폴링 인터벌
    wakeLock: null,           // Screen Wake Lock
    searchDebounceTimer: null
  };

  // 2. 알람 사운드 & 백그라운드 노티 엔진
  const alarm = new window.AlarmSystem();

  // 3. DOM 요소 참조
  const tabGpsMode = document.getElementById('tabGpsMode');
  const tabSubwayMode = document.getElementById('tabSubwayMode');
  const gpsPanel = document.getElementById('gpsPanel');
  const subwayPanel = document.getElementById('subwayPanel');
  const destSearchSectionTitle = document.getElementById('destSearchSectionTitle');
  const selectedDestCard = document.getElementById('selectedDestCard');
  const destIconBox = document.getElementById('destIconBox');
  
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

  const subwayLineSelect = document.getElementById('subwayLineSelect');
  const subwayTriggerSelect = document.getElementById('subwayTriggerSelect');
  const subwayTrainList = document.getElementById('subwayTrainList');
  const subwayLastUpdate = document.getElementById('subwayLastUpdate');

  const statLabel1 = document.getElementById('statLabel1');
  const statLabel2 = document.getElementById('statLabel2');
  const liveDistanceDisplay = document.getElementById('liveDistanceDisplay');
  const liveStatusSubDisplay = document.getElementById('liveStatusSubDisplay');
  const btnToggleWatch = document.getElementById('btnToggleWatch');
  const btnActionText = document.getElementById('btnActionText');
  const btnMyPos = document.getElementById('btnMyPos');
  
  const alarmOverlay = document.getElementById('alarmOverlay');
  const alarmDestName = document.getElementById('alarmDestName');
  const alarmCurrentDist = document.getElementById('alarmCurrentDist');
  const btnDismissAlarm = document.getElementById('btnDismissAlarm');

  // 4. 모드 전환 탭 이벤트 핸들러
  function switchMode(newMode) {
    if (state.isWatching) {
      if (!confirm('현재 감시가 진행 중입니다. 모드를 변경하면 감시가 중단됩니다. 계속하시겠습니까?')) {
        return;
      }
      stopWatching();
    }

    state.mode = newMode;
    clearDestination();

    if (newMode === 'GPS') {
      tabGpsMode.classList.add('active');
      tabSubwayMode.classList.remove('active', 'subway-active');
      gpsPanel.style.display = 'block';
      subwayPanel.style.display = 'none';
      selectedDestCard.classList.remove('subway-mode');
      
      destSearchSectionTitle.textContent = '목적지 설정 (주소 검색 or 지도 클릭)';
      destSearchInput.placeholder = '목적지 주소, 건물명, 장소명 입력...';
      destCoordDisplay.textContent = '검색창 또는 지도에서 원하는 위치를 지정하세요.';
      
      statLabel1.textContent = '남은 직선 거리';
      statLabel2.textContent = 'GPS 수신 오차';
      liveDistanceDisplay.className = 'stat-value highlight';
      btnActionText.textContent = 'GPS 알람 감시 시작 (ON)';

      // 지도 리사이즈 트리거
      setTimeout(() => map.invalidateSize(), 150);
    } else {
      tabSubwayMode.classList.add('active', 'subway-active');
      tabGpsMode.classList.remove('active');
      gpsPanel.style.display = 'none';
      subwayPanel.style.display = 'block';
      selectedDestCard.classList.add('subway-mode');

      destSearchSectionTitle.textContent = '하차 지하철역 검색 및 선택 (서울/수도권)';
      destSearchInput.placeholder = '하차할 지하철역 이름 입력 (예: 역삼, 강남, 홍대입구...)';
      destCoordDisplay.textContent = '하차할 역을 입력하고 알람 시점을 설정하세요.';

      statLabel1.textContent = '실시간 열차 상태';
      statLabel2.textContent = '목적지 하차역';
      liveDistanceDisplay.className = 'stat-value subway-highlight';
      btnActionText.textContent = '지하철 실시간 알람 감시 시작 (ON)';
    }
  }

  tabGpsMode.addEventListener('click', () => switchMode('GPS'));
  tabSubwayMode.addEventListener('click', () => switchMode('SUBWAY'));

  // 5. Leaflet 지도 초기화 (GPS 모드용)
  const defaultCenter = [37.5665, 126.9780];
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView(defaultCenter, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  let destMarker = null;
  let destCircle = null;
  let currentPosMarker = null;
  let currentPosAccuracyCircle = null;

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

  // Haversine 거리 계산 (m)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function formatDistance(meters) {
    if (meters === null || meters === undefined || isNaN(meters)) return '-';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  // 목적지 초기화 (공란 리셋)
  function clearDestination() {
    state.destination = null;
    destSearchInput.value = '';
    destNameDisplay.textContent = '목적지를 설정해주세요';
    destCoordDisplay.textContent = state.mode === 'GPS' 
      ? '검색창 또는 지도에서 원하는 위치를 지정하세요.' 
      : '하차할 지하철역을 검색해 선택하세요.';
    liveDistanceDisplay.textContent = '-';
    liveStatusSubDisplay.textContent = '-';

    if (destMarker) {
      map.removeLayer(destMarker);
      destMarker = null;
    }
    if (destCircle) {
      map.removeLayer(destCircle);
      destCircle = null;
    }

    subwayTrainList.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:10px;">목적지 지하철역을 선택하면 실시간 열차 정보가 표시됩니다.</div>';
    subwayLastUpdate.textContent = '-';

    validateCanStart();
  }

  // 목적지 설정
  function setDestination(lat, lng, name, stationName) {
    state.destination = {
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
      name: name || '선택한 목적지',
      stationName: stationName || null
    };

    destNameDisplay.textContent = state.destination.name;

    if (state.mode === 'GPS') {
      destCoordDisplay.textContent = `위도: ${state.destination.lat.toFixed(5)}, 경도: ${state.destination.lng.toFixed(5)}`;
      
      if (destMarker) {
        destMarker.setLatLng([state.destination.lat, state.destination.lng]);
      } else {
        destMarker = L.marker([state.destination.lat, state.destination.lng], { icon: destIcon }).addTo(map);
      }
      updateDestinationCircle();
      map.flyTo([state.destination.lat, state.destination.lng], Math.max(map.getZoom(), 15), { duration: 1 });

      if (state.currentPosition) {
        updateDistanceCheck();
      }
    } else {
      // 지하철 모드: 실시간 도착 정보 즉시 1회 조회
      const cleanStation = (stationName || name).replace(/역$/, '').trim();
      destCoordDisplay.textContent = `서울/수도권 실시간 지하철역: ${cleanStation}역`;
      liveStatusSubDisplay.textContent = `${cleanStation}역`;
      fetchSubwayRealtimeArrival(cleanStation);
    }

    validateCanStart();
  }

  function updateDestinationCircle() {
    if (!state.destination || !state.destination.lat) return;

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

  function setRadiusValue(meters) {
    const val = Math.max(50, Math.min(10000, Math.round(meters)));
    state.radiusMeters = val;
    radiusRange.value = Math.min(val, 5000);
    radiusDisplay.textContent = formatDistance(val);

    if (radiusUnitSelect.value === 'km') {
      radiusNumberInput.value = (val / 1000).toFixed(2);
    } else {
      radiusNumberInput.value = val;
    }

    chipButtons.forEach(btn => {
      const chipMeters = parseInt(btn.getAttribute('data-value'), 10);
      btn.classList.toggle('active', chipMeters === val);
    });

    updateDestinationCircle();
    if (state.currentPosition && state.isWatching && state.mode === 'GPS') {
      updateDistanceCheck();
    }
  }

  radiusRange.addEventListener('input', (e) => setRadiusValue(parseInt(e.target.value, 10)));
  radiusNumberInput.addEventListener('input', () => {
    const rawVal = parseFloat(radiusNumberInput.value);
    if (!isNaN(rawVal) && rawVal > 0) {
      setRadiusValue(radiusUnitSelect.value === 'km' ? rawVal * 1000 : rawVal);
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
    btn.addEventListener('click', () => setRadiusValue(parseInt(btn.getAttribute('data-value'), 10)));
  });

  subwayLineSelect.addEventListener('change', (e) => {
    state.subwayLine = e.target.value;
    if (state.destination && state.mode === 'SUBWAY') {
      const cleanStation = (state.destination.stationName || state.destination.name).replace(/역$/, '').trim();
      fetchSubwayRealtimeArrival(cleanStation);
    }
  });

  subwayTriggerSelect.addEventListener('change', (e) => {
    state.subwayTrigger = e.target.value;
  });

  // 6. 지오코딩 및 지하철역 스마트 검색
  function cleanKoreanQuery(query) {
    let q = query.trim();
    const suffixPattern = /(앞|뒤|옆|근처|주변|부근|사거리|삼거리|오거리|역앞)$/i;
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
        isStation: item.display_name.includes('역') || item.class === 'railway'
      }));
    } catch (e) {
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
        const coords = f.geometry.coordinates;
        const name = props.name || props.street || props.city || '선택 위치';
        const details = [props.state, props.city || props.county, props.district, props.street].filter(Boolean).join(' ');
        return {
          lat: coords[1],
          lng: coords[0],
          title: name,
          subtitle: details || name,
          isStation: name.includes('역') || (details && details.includes('역'))
        };
      });
    } catch (e) {
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
      searchResultsBox.innerHTML = '<div style="padding:12px; font-size:0.8rem; color:#8e9eb5;">장소 및 지하철역 검색 중...</div>';
      searchResultsBox.classList.add('show');

      // 지하철 모드일 경우: '역' 키워드 우선 보정
      let searchQueries = [rawQuery];
      if (state.mode === 'SUBWAY' && !rawQuery.endsWith('역')) {
        searchQueries.unshift(`${rawQuery}역`);
      }
      if (refinedQuery) searchQueries.push(refinedQuery);

      let allResults = [];
      for (const q of searchQueries) {
        const [nom, pho] = await Promise.all([fetchNominatim(q), fetchPhoton(q)]);
        allResults = [...allResults, ...nom, ...pho];
        if (allResults.length >= 4) break;
      }

      // 중복 제거
      const uniqueResults = [];
      const seen = new Set();
      for (const item of allResults) {
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
              정확한 역 이름이나 주소를 입력해주세요.
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
          let stationName = item.title;
          // 지하철 모드일 때 역 이름 정제
          if (state.mode === 'SUBWAY') {
            stationName = item.title.replace(/역.*$/, '').trim();
            if (!stationName) stationName = item.title;
          }

          setDestination(item.lat, item.lng, item.title, stationName);
          destSearchInput.value = item.title;
          searchResultsBox.classList.remove('show');
        });

        searchResultsBox.appendChild(itemDiv);
      });
    } catch (err) {
      console.error('Search error:', err);
      searchResultsBox.innerHTML = '<div style="padding:12px; font-size:0.8rem; color:#ef4444;">검색 중 오류가 발생했습니다.</div>';
    }
  }

  destSearchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => searchLocation(e.target.value), 400);
  });

  destSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(state.searchDebounceTimer);
      searchLocation(destSearchInput.value);
    }
  });

  btnSearch.addEventListener('click', () => searchLocation(destSearchInput.value));

  document.addEventListener('click', (e) => {
    if (!destSearchInput.contains(e.target) && !searchResultsBox.contains(e.target)) {
      searchResultsBox.classList.remove('show');
    }
  });

  // 지도 클릭 (GPS 모드)
  map.on('click', async (e) => {
    if (state.mode !== 'GPS') return;
    const { lat, lng } = e.latlng;
    setDestination(lat, lng, '지도에서 선택한 위치');

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko,en' } });
      const data = await res.json();
      if (data && data.display_name) {
        setDestination(lat, lng, data.display_name);
        destSearchInput.value = data.display_name.split(',')[0];
      }
    } catch (err) {}
  });

  // 7. 서울시 실시간 지하철 OpenAPI 조회 함수
  async function fetchSubwayRealtimeArrival(stationName) {
    if (!stationName) return null;
    const cleanStation = stationName.replace(/역$/, '').trim();

    // Vercel Serverless Function 프록시 호출 (실패 시 direct 호출 폴백)
    const endpoints = [
      `/api/subway?station=${encodeURIComponent(cleanStation)}`,
      `https://swopenAPI.seoul.go.kr/api/subway/${SEOUL_SUBWAY_API_KEY}/json/realtimeStationArrival/0/20/${encodeURIComponent(cleanStation)}`,
      `http://swopenAPI.seoul.go.kr/api/subway/${SEOUL_SUBWAY_API_KEY}/json/realtimeStationArrival/0/20/${encodeURIComponent(cleanStation)}`
    ];

    let data = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (res.ok) {
          const json = await res.json();
          if (json && (json.realtimeArrivalList || json.errorMessage)) {
            data = json;
            break;
          }
        }
      } catch (e) {}
    }

    if (!data || !data.realtimeArrivalList || data.realtimeArrivalList.length === 0) {
      subwayTrainList.innerHTML = `
        <div style="font-size:0.8rem; color:#f87171; text-align:center; padding:10px;">
          '${cleanStation}역' 실시간 운행 정보가 없거나 첫차/막차 시간 외입니다.
        </div>
      `;
      subwayLastUpdate.textContent = new Date().toLocaleTimeString('ko-KR');
      return null;
    }

    renderSubwayFeeds(data.realtimeArrivalList, cleanStation);
    return data.realtimeArrivalList;
  }

  // 실시간 도착 피드 UI 렌더링 & 알람 조건 체크
  function renderSubwayFeeds(list, stationName) {
    const nowStr = new Date().toLocaleTimeString('ko-KR');
    subwayLastUpdate.textContent = nowStr;

    // 호선 필터 적용
    let filtered = list;
    if (state.subwayLine !== 'ALL') {
      filtered = list.filter(item => item.subwayId === state.subwayLine);
    }

    if (filtered.length === 0) {
      subwayTrainList.innerHTML = `<div style="font-size:0.8rem; color:#8e9eb5; text-align:center; padding:10px;">선택한 호선의 실시간 열차가 없습니다.</div>`;
      return;
    }

    subwayTrainList.innerHTML = '';
    
    // 호선 이름 맵
    const lineNames = {
      '1001': '1호선', '1002': '2호선', '1003': '3호선', '1004': '4호선',
      '1005': '5호선', '1006': '6호선', '1007': '7호선', '1008': '8호선',
      '1009': '9호선', '1077': '신분당선', '1065': '공항철도', '1063': '경의중앙', '1075': '수인분당'
    };

    let closestStatus = filtered[0].arvlMsg2 || filtered[0].arvlMsg3;
    liveDistanceDisplay.textContent = closestStatus;

    filtered.slice(0, 4).forEach(item => {
      const lineName = lineNames[item.subwayId] || `${item.subwayId}`;
      const trainCard = document.createElement('div');
      trainCard.className = 'subway-train-card';

      trainCard.innerHTML = `
        <div style="display:flex; align-items:center;">
          <span class="train-line-badge">${lineName}</span>
          <span class="train-dest">${item.trainLineNm || item.bstatnNm + '행'}</span>
        </div>
        <span class="train-msg">${item.arvlMsg2 || item.arvlMsg3}</span>
      `;

      subwayTrainList.appendChild(trainCard);

      // 감시 중일 때 알람 조건 만족 여부 확인
      if (state.isWatching && !state.isAlarmRinging && state.mode === 'SUBWAY') {
        checkSubwayAlarmCondition(item, stationName);
      }
    });
  }

  // 지하철 알람 조건 판별 로직
  function checkSubwayAlarmCondition(trainItem, stationName) {
    const msg = (trainItem.arvlMsg2 || '') + (trainItem.arvlMsg3 || '');
    const arvlCd = trainItem.arvlCd; // '0':진입, '1':도착, '3':전역출발, '4':전역진입, '5':전역도착

    let shouldTrigger = false;
    let triggerReason = '';

    // 1정거장 전 알람 ('1')
    if (state.subwayTrigger === '1') {
      if (
        msg.includes('전역') || 
        arvlCd === '3' || arvlCd === '4' || arvlCd === '5' || 
        msg.includes('도착') || msg.includes('진입')
      ) {
        shouldTrigger = true;
        triggerReason = `[${trainItem.trainLineNm || stationName}] ${trainItem.arvlMsg2 || '전역 진입/도착'}`;
      }
    } 
    // 2정거장 전 알람 ('2')
    else if (state.subwayTrigger === '2') {
      if (
        msg.includes('2번째') || msg.includes('두번째') || 
        msg.includes('전역') || arvlCd === '4' || arvlCd === '5'
      ) {
        shouldTrigger = true;
        triggerReason = `[${trainItem.trainLineNm || stationName}] ${trainItem.arvlMsg2 || '2정거장 전 접근'}`;
      }
    } 
    // 목적지역 도착 즉시 ('0')
    else if (state.subwayTrigger === '0') {
      if (
        (msg.includes(stationName) && (msg.includes('도착') || msg.includes('진입'))) ||
        arvlCd === '0' || arvlCd === '1'
      ) {
        shouldTrigger = true;
        triggerReason = `[${stationName}역] 열차가 지금 도착/진입합니다!`;
      }
    }

    if (shouldTrigger) {
      triggerAlarm(triggerReason);
    }
  }

  // 8. GPS 위치 갱신
  function updateCurrentPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    state.currentPosition = { lat: latitude, lng: longitude, accuracy };

    liveStatusSubDisplay.textContent = `±${Math.round(accuracy)} m`;

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

    if (state.mode === 'GPS') {
      updateDistanceCheck();
    }
  }

  btnMyPos.addEventListener('click', () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          updateCurrentPosition(pos);
          map.flyTo([pos.coords.latitude, pos.coords.longitude], 16);
        },
        (err) => alert('현재 위치 정보를 가져올 수 없습니다: ' + err.message),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  });

  // GPS 거리 체크 & 알람 판단
  function updateDistanceCheck() {
    if (!state.destination || !state.destination.lat || !state.currentPosition) {
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

    if (state.isWatching && !state.isAlarmRinging && dist <= state.radiusMeters) {
      triggerAlarm(`목적지까지 약 ${formatDistance(dist)} 남았습니다!`);
    }
  }

  // 9. Screen Wake Lock (화면 꺼짐 방지)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) {}
    }
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => {});
      state.wakeLock = null;
    }
  }

  // 10. 알람 발동 (유튜브 등 타 앱 오버라이드 포함)
  async function triggerAlarm(infoText) {
    state.isAlarmRinging = true;

    const destTitle = state.destination ? (state.destination.name || '목적지') : '목적지';

    // 사운드 + 진동 + 백그라운드 시스템 푸시 알림
    await alarm.start(destTitle, infoText);

    // 풀스크린 모달 UI 표시
    alarmDestName.textContent = destTitle;
    alarmCurrentDist.textContent = infoText || '목적지에 곧 도착합니다!';
    alarmOverlay.classList.add('active');

    updateStatusUI('alert', '🚨 하차 알람 작동 중!');
  }

  // 11. 수동 [알람 끄기] 프로세스
  function stopAndDismissAlarm() {
    alarm.stop();
    state.isAlarmRinging = false;
    alarmOverlay.classList.remove('active');
    stopWatching();
  }

  btnDismissAlarm.addEventListener('click', stopAndDismissAlarm);

  // 12. 감시 시작 / 중단 토글
  async function startWatching() {
    if (!state.destination) {
      alert('먼저 목적지(또는 하차할 지하철역)를 설정해 주세요.');
      return;
    }

    // 모바일 브라우저 오디오 & 백그라운드 유지 활성화 + 시스템 알림 권한 획득
    await alarm.prime();

    // 화면 꺼짐 방지
    await requestWakeLock();

    state.isWatching = true;
    updateStatusUI('active', state.mode === 'GPS' ? '실시간 GPS 감시 중' : '실시간 지하철 감시 중');

    btnToggleWatch.textContent = '감시 중단 (OFF)';
    btnToggleWatch.className = 'main-action-btn stop-btn';

    if (state.mode === 'GPS') {
      if (!navigator.geolocation) {
        alert('이 기기는 GPS 위치 서비스를 지원하지 않습니다.');
        stopWatching();
        return;
      }

      state.watchId = navigator.geolocation.watchPosition(
        (pos) => updateCurrentPosition(pos),
        (err) => {
          let msg = 'GPS 수신 오류';
          if (err.code === 1) msg = '위치 권한이 거부되었습니다.';
          statusText.textContent = msg;
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
      );
    } else {
      // 지하철 모드: 15초 주기로 실시간 도착정보 폴링
      const cleanStation = (state.destination.stationName || state.destination.name).replace(/역$/, '').trim();
      fetchSubwayRealtimeArrival(cleanStation);

      state.subwayPollInterval = setInterval(() => {
        if (state.isWatching && !state.isAlarmRinging) {
          fetchSubwayRealtimeArrival(cleanStation);
        }
      }, 15000);
    }
  }

  function stopWatching() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }

    if (state.subwayPollInterval !== null) {
      clearInterval(state.subwayPollInterval);
      state.subwayPollInterval = null;
    }

    releaseWakeLock();

    state.isWatching = false;
    updateStatusUI('idle', '대기 중');

    btnToggleWatch.className = 'main-action-btn start-btn';
    btnActionText.textContent = state.mode === 'GPS' ? 'GPS 알람 감시 시작 (ON)' : '지하철 실시간 알람 감시 시작 (ON)';

    clearDestination();
  }

  btnToggleWatch.addEventListener('click', () => {
    if (state.isWatching) {
      stopWatching();
    } else {
      startWatching();
    }
  });

  function updateStatusUI(type, text) {
    statusPill.className = `status-pill ${type}`;
    statusText.textContent = text;
  }

  function validateCanStart() {
    btnToggleWatch.disabled = !state.destination;
  }

  // 초기 위치 획득 시도
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateCurrentPosition(pos);
        map.setView([pos.coords.latitude, pos.coords.longitude], 15);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }

  setRadiusValue(500);
  validateCanStart();
});
