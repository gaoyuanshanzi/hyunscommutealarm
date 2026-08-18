/**
 * alarm.js — Web Audio API 기반 알람 사운드 & 백그라운드 알림/오디오 유지 시스템
 * - 외부 오디오 파일 없이 긴급 경고 비프음 생성
 * - 백그라운드 Audio Keep-Alive를 통해 유튜브 등 타 앱 실행 중에도 프로세스 유지
 * - Web Notifications API 시스템 팝업 알림 연동
 */

class AlarmSystem {
  constructor() {
    this.audioCtx = null;
    this.isPlaying = false;
    this.intervalId = null;
    this.vibrateIntervalId = null;
    this.keepAliveOsc = null;
    this.keepAliveGain = null;
    this.hasNotificationPermission = false;
    this.titleBlinkInterval = null;
    this.originalTitle = document.title;
  }

  /**
   * AudioContext를 초기화/재개하고 백그라운드 유지(Keep-Alive)를 시작합니다.
   * 사용자 터치 제스처 시 호출되어 브라우저의 Autoplay 정책 및 백그라운드 슬립을 방지합니다.
   */
  async prime() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // 시스템 알림(Notification) 권한 요청 (타 앱 실행 시 상단 알림 배너용)
    if ('Notification' in window && Notification.permission !== 'granted') {
      try {
        const perm = await Notification.requestPermission();
        this.hasNotificationPermission = (perm === 'granted');
      } catch (e) {
        console.warn('Notification permission error:', e);
      }
    } else if ('Notification' in window && Notification.permission === 'granted') {
      this.hasNotificationPermission = true;
    }

    // 백그라운드 Audio Keep-Alive 시작 (인간의 귀에 들리지 않는 0.0001 볼륨의 초저주파 신호로 오디오 세션 유지)
    this._startKeepAlive();
  }

  /**
   * 백그라운드 프로세스 슬립 방지용 미세 오디오 루프
   */
  _startKeepAlive() {
    if (!this.audioCtx || this.keepAliveOsc) return;

    try {
      this.keepAliveOsc = this.audioCtx.createOscillator();
      this.keepAliveGain = this.audioCtx.createGain();

      this.keepAliveOsc.frequency.setValueAtTime(30, this.audioCtx.currentTime); // 30Hz 초저주파
      this.keepAliveGain.gain.setValueAtTime(0.0001, this.audioCtx.currentTime); // 거의 무음

      this.keepAliveOsc.connect(this.keepAliveGain);
      this.keepAliveGain.connect(this.audioCtx.destination);
      this.keepAliveOsc.start();
    } catch (e) {
      console.warn('Keep-alive oscillator error:', e);
    }
  }

  _stopKeepAlive() {
    if (this.keepAliveOsc) {
      try {
        this.keepAliveOsc.stop();
        this.keepAliveOsc.disconnect();
      } catch (e) {}
      this.keepAliveOsc = null;
    }
    if (this.keepAliveGain) {
      try {
        this.keepAliveGain.disconnect();
      } catch (e) {}
      this.keepAliveGain = null;
    }
  }

  /**
   * 경고 비프음 1회 생성 및 재생
   */
  _playBeep(frequency1, frequency2, duration, startTime = 0) {
    if (!this.audioCtx) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime + startTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.7, now + 0.02); // 강력한 볼륨
    masterGain.gain.setValueAtTime(0.7, now + duration - 0.04);
    masterGain.gain.linearRampToValueAtTime(0, now + duration);
    masterGain.connect(ctx.destination);

    // 메인 오실레이터
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(frequency1, now);
    osc1.frequency.exponentialRampToValueAtTime(frequency2, now + duration * 0.5);
    osc1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + duration);

    // 배음 오실레이터 (경고음 긴급도 상승)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(frequency1 * 1.5, now);
    const gainOsc2 = ctx.createGain();
    gainOsc2.gain.setValueAtTime(0.2, now);
    osc2.connect(gainOsc2);
    gainOsc2.connect(masterGain);
    osc2.start(now);
    osc2.stop(now + duration);
  }

  /**
   * 알람 패턴 1회 재생
   */
  _playAlarmPattern() {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // 긴급 3단 경고음 패턴
    this._playBeep(987.77, 783.99, 0.18, 0.0);  // B5 -> G5
    this._playBeep(783.99, 987.77, 0.18, 0.22); // G5 -> B5
    this._playBeep(987.77, 1318.51, 0.35, 0.44); // B5 -> E6 상승

    // 강력 진동
    if (navigator.vibrate) {
      navigator.vibrate([300, 100, 300, 100, 500]);
    }
  }

  /**
   * 유튜브 등 타 앱 실행 중에도 상단에 표시되는 시스템 알림 전송
   */
  sendSystemNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body: body || '설정하신 목적지/하차역에 도착했습니다! 지금 확인해주세요.',
          icon: '/icons/icon.svg',
          badge: '/icons/icon.svg',
          tag: 'commute-arrival-alert',
          renotify: true,
          requireInteraction: true, // 사용자가 닫거나 누를 때까지 상단에 유지
          vibrate: [500, 200, 500, 200, 1000]
        });

        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (e) {
        console.warn('System notification launch error:', e);
      }
    }
  }

  /**
   * 알람 시작 (사용자가 끌 때까지 반복)
   */
  async start(destTitle, infoText) {
    if (this.isPlaying) return;
    await this.prime();

    this.isPlaying = true;
    this._playAlarmPattern();

    // 1초마다 알람 사운드 반복 재생
    this.intervalId = setInterval(() => {
      if (this.isPlaying) {
        this._playAlarmPattern();
      }
    }, 1000);

    // 진동 반복 인터벌 (모바일 기기 대응)
    if (navigator.vibrate) {
      this.vibrateIntervalId = setInterval(() => {
        if (this.isPlaying) {
          navigator.vibrate([400, 150, 400, 150, 600]);
        }
      }, 1800);
    }

    // 시스템 푸시 알림 발생 (유튜브 등 다른 화면 위에 팝업)
    this.sendSystemNotification(
      '🚨 [하차 알람] 목적지에 도착했습니다!',
      `${destTitle || '목적지'}: ${infoText || '지금 하차를 준비하세요!'}`
    );

    // 브라우저 탭 타이틀 깜빡임
    let toggle = false;
    this.titleBlinkInterval = setInterval(() => {
      document.title = toggle ? '🚨🚨 [하차 알람!] 🚨🚨' : '🔔 지금 내리세요! 🔔';
      toggle = !toggle;
    }, 500);
  }

  /**
   * 알람 완전 중단
   */
  stop() {
    this.isPlaying = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.vibrateIntervalId) {
      clearInterval(this.vibrateIntervalId);
      this.vibrateIntervalId = null;
    }
    if (this.titleBlinkInterval) {
      clearInterval(this.titleBlinkInterval);
      this.titleBlinkInterval = null;
      document.title = this.originalTitle;
    }

    // 진동 즉시 중단
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }

    this._stopKeepAlive();
  }

  getState() {
    return this.audioCtx ? this.audioCtx.state : 'uninitialized';
  }
}

window.AlarmSystem = AlarmSystem;
