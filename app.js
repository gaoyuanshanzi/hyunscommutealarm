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
    selectedTrainNo: null,    // 사용자가 직접 선택한 열차 번호/고유키
    selectedTrainDesc: null,  // 선택된 열차 정보 요약 문구
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
    state.selectedTrainNo = null;
    state.selectedTrainDesc = null;
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
    state.selectedTrainNo = null;
    state.selectedTrainDesc = null;

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
      liveDistanceDisplay.textContent = '운행 열차 없음';
      return;
    }

    subwayTrainList.innerHTML = '';
    
    // 호선 이름 맵
    const lineNames = {
      '1001': '1호선', '1002': '2호선', '1003': '3호선', '1004': '4호선',
      '1005': '5호선', '1006': '6호선', '1007': '7호선', '1008': '8호선',
      '1009': '9호선', '1077': '신분당선', '1065': '공항철도', '1063': '경의중앙', '1075': '수인분당'
    };

    // 선택된 열차 찾기
    let selectedTrain = null;
    if (state.selectedTrainNo) {
      selectedTrain = filtered.find(item => (item.btrainNo || item.trainLineNm) === state.selectedTrainNo);
    }

    // 상단 상태바 텍스트 업데이트
    if (selectedTrain) {
      liveDistanceDisplay.textContent = selectedTrain.arvlMsg2 || selectedTrain.arvlMsg3;
      liveStatusSubDisplay.textContent = `선택 열차 #${selectedTrain.btrainNo || ''}`;
    } else if (state.selectedTrainNo) {
      // 이전에 선택했던 열차가 도착 완료되었거나 목록에서 벗어난 경우
      liveDistanceDisplay.textContent = '선택 열차 도착/통과';
      liveStatusSubDisplay.textContent = '열차 도착 완료';
    } else {
      liveDistanceDisplay.textContent = '열차를 터치해 선택하세요';
      liveStatusSubDisplay.textContent = `${stationName}역 (${filtered.length}대 운행중)`;
    }

    filtered.slice(0, 6).forEach(item => {
      const lineName = lineNames[item.subwayId] || `${item.subwayId}`;
      const trainKey = item.btrainNo || item.trainLineNm;
      const isSelected = state.selectedTrainNo && (trainKey === state.selectedTrainNo);

      const trainCard = document.createElement('div');
      trainCard.className = isSelected ? 'subway-train-card selected' : 'subway-train-card';

      trainCard.innerHTML = `
        <div class="train-info-left">
          <div class="train-radio-dot"></div>
          <span class="train-line-badge">${lineName}</span>
          <div class="train-dest-wrap">
            <span class="train-dest">
              ${item.trainLineNm || item.bstatnNm + '행'}
              ${item.btrainNo ? '<span style="font-size:0.75rem; color:#8e9eb5; font-weight:normal;">(열차 #' + item.btrainNo + ')</span>' : ''}
            </span>
            ${isSelected ? '<span class="train-selected-badge">🚆 내가 탄 열차로 선택됨</span>' : ''}
          </div>
        </div>
        <span class="train-msg">${item.arvlMsg2 || item.arvlMsg3}</span>
      `;

      // 열차 카드 터치 시 해당 열차 단독 선택
      trainCard.addEventListener('click', () => {
        state.selectedTrainNo = trainKey;
        state.selectedTrainDesc = `[${lineName}] ${item.trainLineNm || item.bstatnNm + '행'}${item.btrainNo ? ' (#' + item.btrainNo + ')' : ''}`;
        renderSubwayFeeds(list, stationName);
      });

      subwayTrainList.appendChild(trainCard);

      // 감시 중일 때: 오직 사용자가 선택한 열차만 알람 조건 검사
      if (state.isWatching && !state.isAlarmRinging && state.mode === 'SUBWAY' && isSelected) {
        checkSubwayAlarmCondition(item, stationName);
      }
    });
  }

  // 서울시 지하철 도착 메시지 및 코드로부터 목적지까지 남은 정거장 수 파싱
  function parseSubwayRemainStations(msg, arvlCd, targetStationName) {
    if (!msg) msg = '';

    // 1) 당역 도착 / 진입 (0정거장 남음)
    if (arvlCd === '0' || arvlCd === '1') {
      return 0;
    }
    const targetClean = (targetStationName || '').replace(/역$/, '').trim();
    if (targetClean && (
      msg.includes(`${targetClean} 도착`) || msg.includes(`${targetClean} 진입`) || 
      msg.includes(`${targetClean}도착`) || msg.includes(`${targetClean}진입`) ||
      msg.includes('당역 도착') || msg.includes('당역 진입')
    )) {
      return 0;
    }

    // 2) "[N]번째 전역", "N번째 전역", "[N]전역" 정규식 패턴 파싱 (예: "[6]번째 전역", "[2]번째 전역")
    const nStationMatch = msg.match(/\[?(\d+)\]?\s*번째?\s*전역/);
    if (nStationMatch && nStationMatch[1]) {
      return parseInt(nStationMatch[1], 10);
    }

    // 3) 숫자 없이 단독으로 "전역 도착", "전역 진입", "전역 출발" 또는 arvlCd 3, 4, 5 (1정거장 남음)
    if (arvlCd === '3' || arvlCd === '4' || arvlCd === '5') {
      return 1;
    }
    if (msg.includes('전역 도착') || msg.includes('전역 진입') || msg.includes('전역 출발') || msg.startsWith('전역')) {
      return 1;
    }

    // 4) 분 단위 도착 메시지 (예: "3분 후 도착", "2분 후 도착")
    const minMatch = msg.match(/(\d+)\s*분/);
    if (minMatch && minMatch[1]) {
      const minutes = parseInt(minMatch[1], 10);
      if (minutes <= 2) return 1;
      if (minutes <= 4) return 2;
      return Math.ceil(minutes / 2);
    }

    // 파싱 불가 시 기본 안전값 (99 - 알람 안 울림)
    return 99;
  }

  // 지하철 알람 조건 판별 로직 (사용자가 선택한 특정 열차 전용)
  function checkSubwayAlarmCondition(trainItem, stationName) {
    const trainKey = trainItem.btrainNo || trainItem.trainLineNm;
    
    // 사용자가 선택한 열차가 아니면 무시
    if (!state.selectedTrainNo || trainKey !== state.selectedTrainNo) {
      return;
    }

    const msg = (trainItem.arvlMsg2 || '') + ' ' + (trainItem.arvlMsg3 || '');
    const arvlCd = trainItem.arvlCd;
    const cleanTargetStation = (stationName || (state.destination ? state.destination.name : '')).replace(/역$/, '').trim();

    // 남은 정거장 수 정밀 계산
    const remainStations = parseSubwayRemainStations(msg, arvlCd, cleanTargetStation);

    let shouldTrigger = false;
    let triggerReason = '';
    const trainDesc = state.selectedTrainDesc || `[${cleanTargetStation}역 방면 열차]`;

    // 1정거장 전 알람 ('1')
    if (state.subwayTrigger === '1') {
      // 남은 역 수가 1 이하(1정거장 전 또는 당역)일 때만 울림 (2 이상은 절대 안 울림)
      if (remainStations <= 1) {
        shouldTrigger = true;
        triggerReason = `${trainDesc} ${trainItem.arvlMsg2 || '1정거장 전 접근'}`;
      }
    } 
    // 2정거장 전 알람 ('2')
    else if (state.subwayTrigger === '2') {
      // 남은 역 수가 2 이하(2정거장 전, 1정거장 전, 당역)일 때만 울림 (3 이상은 절대 안 울림)
      if (remainStations <= 2) {
        shouldTrigger = true;
        triggerReason = `${trainDesc} ${trainItem.arvlMsg2 || '2정거장 전 접근'}`;
      }
    } 
    // 목적지역 도착 즉시 ('0')
    else if (state.subwayTrigger === '0') {
      if (remainStations === 0) {
        shouldTrigger = true;
        triggerReason = `${trainDesc} ${cleanTargetStation}역에 지금 도착/진입합니다!`;
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

    if (state.mode === 'SUBWAY' && !state.selectedTrainNo) {
      alert('실시간 목록에서 탑승하신 열차를 먼저 1대 터치하여 선택해주세요.');
      return;
    }

    // 모바일 브라우저 오디오 & 백그라운드 유지 활성화 + 시스템 알림 권한 획득
    await alarm.prime();

    // 화면 꺼짐 방지
    await requestWakeLock();

    state.isWatching = true;
    const activeMsg = state.mode === 'GPS' 
      ? '실시간 GPS 감시 중' 
      : (state.selectedTrainDesc ? `${state.selectedTrainDesc} 감시 중` : '선택 열차 감시 중');
    updateStatusUI('active', activeMsg);

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
