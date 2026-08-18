// Vercel Serverless Function: /api/subway.js
// 서울시 실시간 지하철 OpenAPI 프록시 (CORS & HTTPS Mixed Content 해결)

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { station, line } = req.query;
  const API_KEY = process.env.SEOUL_SUBWAY_API_KEY || '484443435773616d31303964664b4464';

  if (!station && !line) {
    return res.status(400).json({ error: 'station or line parameter is required' });
  }

  try {
    let url = '';
    if (station) {
      // 역명 정제: '역' 접미사 제거 (예: '역삼역' -> '역삼')
      const cleanStation = station.replace(/역$/, '').trim();
      url = `http://swopenAPI.seoul.go.kr/api/subway/${API_KEY}/json/realtimeStationArrival/0/20/${encodeURIComponent(cleanStation)}`;
    } else if (line) {
      url = `http://swopenAPI.seoul.go.kr/api/subway/${API_KEY}/json/realtimePosition/0/50/${encodeURIComponent(line)}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Seoul API responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Subway API Proxy Error:', error);
    return res.status(500).json({ error: 'Failed to fetch subway data', details: error.message });
  }
}
