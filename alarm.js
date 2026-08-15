/**
 * alarm.js — Web Audio API 기반 알람 사운드 시스템
 * 외부 오디오 파일 없이 브라우저 내에서 직접 경고음을 생성합니다.
 */

class AlarmSystem {
  constructor() {
    this.audioCtx = null;
    this.isPlaying = false;
    this.intervalId = null;
    this.gainNode = null;
    this.activeOscillators = [];
  }

  /**
   * AudioContext를 초기화/재개합니다.
   * 사용자 제스처(버튼 클릭) 시 반드시 호출해야 autoplay 정책을 우회합니다.
   */
  async prime() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  /**
   * 경고 비프음 1회 재생
   * @param {number} frequency1 - 첫 번째 주파수 (Hz)
   * @param {number} frequency2 - 두 번째 주파수 (Hz)
   * @param {number} duration   - 재생 시간 (초)
   * @param {number} startTime  - 시작 시간 오프셋 (초)
   */
  _playBeep(frequency1, frequency2, duration, startTime = 0) {
    if (!this.audioCtx) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime + startTime;

    // Master gain (음량 조절 + 부드러운 페이드)
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.4, now + 0.02);
    masterGain.gain.setValueAtTime(0.4, now + duration - 0.05);
    masterGain.gain.linearRampToValueAtTime(0, now + duration);
    masterGain.connect(ctx.destination);

    // 오실레이터 1 (메인 톤)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(frequency1, now);
    osc1.frequency.exponentialRampToValueAtTime(frequency2, now + duration * 0.5);
    osc1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + duration);

    // 오실레이터 2 (배음, 긴급함 강조)
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(frequency1 * 1.5, now);
    const gainOsc2 = ctx.createGain();
    gainOsc2.gain.setValueAtTime(0.1, now);
    osc2.connect(gainOsc2);
    gainOsc2.connect(masterGain);
    osc2.start(now);
    osc2.stop(now + duration);

    this.activeOscillators.push(osc1, osc2);
  }

  /**
   * 알람 패턴 1회 재생 (경고음 3연타)
   */
  _playAlarmPattern() {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;

    // 패턴: 높은 음 → 낮은 음 → 높은 음 (긴급감)
    this._playBeep(880, 660, 0.18, 0.0);  // 첫 번째 비프
    this._playBeep(660, 880, 0.18, 0.25); // 두 번째 비프
    this._playBeep(880, 1100, 0.3, 0.5);  // 세 번째 비프 (상승)

    // 진동 (지원 기기)
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  }

  /**
   * 알람 시작 (사용자가 끌 때까지 반복)
   */
  async start() {
    if (this.isPlaying) return;
    await this.prime();

    this.isPlaying = true;
    this._playAlarmPattern(); // 즉시 1회 재생

    // 1.2초마다 반복 재생
    this.intervalId = setInterval(() => {
      if (this.isPlaying) {
        this._playAlarmPattern();
      }
    }, 1200);
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

    // 재생 중인 모든 오실레이터 즉시 중단
    this.activeOscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {
        // 이미 정지된 경우 무시
      }
    });
    this.activeOscillators = [];

    // 진동 중단
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }
  }

  /**
   * AudioContext 상태 반환
   */
  getState() {
    return this.audioCtx ? this.audioCtx.state : 'uninitialized';
  }
}

// 전역 인스턴스 export
window.AlarmSystem = AlarmSystem;
