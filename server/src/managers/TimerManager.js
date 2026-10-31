const {
  DEFAULT_TIMER_DURATION_SEC,
  TIMER_WARNING_YELLOW_SEC,
  TIMER_WARNING_RED_SEC
} = require('../config/constants');

/**
 * Quản lý Đồng hồ đếm ngược 15 phút đồng bộ theo giờ máy chủ (Server-authoritative Timer)
 * - Không bị trôi giờ (clock drift) nhờ tính toán trực tiếp qua mốc Date.now() của server
 * - Tự động phát cảnh báo mốc 3 phút (vàng) và 1 phút (đỏ)
 */
class TimerManager {
  /**
   * @param {(roomCode: string, syncPayload: object) => void} onBroadcastSync Callback phát gói timer.sync xuống phòng
   */
  constructor(onBroadcastSync = null) {
    this.timers = new Map();
    this.onBroadcastSync = onBroadcastSync;
    this.tickInterval = null;
  }

  /**
   * Khởi tạo bộ đếm nhịp toàn cục (1 giây / lần cho các phòng đang chạy)
   */
  startTicker() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      this._tickAll();
    }, 1000);
    if (typeof this.tickInterval.unref === 'function') {
      this.tickInterval.unref();
    }
  }

  /**
   * Dừng bộ đếm nhịp (khi tắt server)
   */
  stopTicker() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Đảm bảo phòng có state đồng hồ mặc định (15 phút = 900s)
   */
  ensureTimer(roomCode, durationSec = DEFAULT_TIMER_DURATION_SEC) {
    if (!this.timers.has(roomCode)) {
      this.timers.set(roomCode, {
        status: 'stopped', // 'stopped' | 'running' | 'paused'
        duration: durationSec,
        accumulatedMs: 0,
        lastStartedAt: null
      });
    }
    return this.timers.get(roomCode);
  }

  /**
   * Xóa đồng hồ khi phòng bị hủy
   */
  removeTimer(roomCode) {
    this.timers.delete(roomCode);
  }

  /**
   * Thực thi lệnh điều khiển từ Host / Projector: start | pause | resume | reset | setDuration
   */
  control(roomCode, action, customDurationSec) {
    const timer = this.ensureTimer(roomCode);
    const now = Date.now();

    switch (action) {
      case 'start': {
        if (typeof customDurationSec === 'number' && customDurationSec >= 10) {
          timer.duration = customDurationSec;
          timer.accumulatedMs = 0;
        } else if (this._getElapsedMs(timer, now) >= timer.duration * 1000) {
          // Nếu đã chạy hết 15 phút mà bấm start lại -> chạy mới từ đầu
          timer.accumulatedMs = 0;
        }
        if (timer.status !== 'running') {
          timer.status = 'running';
          timer.lastStartedAt = now;
        }
        this.startTicker();
        break;
      }

      case 'pause': {
        if (timer.status === 'running') {
          timer.accumulatedMs = this._getElapsedMs(timer, now);
          timer.lastStartedAt = null;
          timer.status = 'paused';
        }
        break;
      }

      case 'resume': {
        if (timer.status === 'paused' && this._getElapsedMs(timer, now) < timer.duration * 1000) {
          timer.status = 'running';
          timer.lastStartedAt = now;
          this.startTicker();
        }
        break;
      }

      case 'reset': {
        if (typeof customDurationSec === 'number' && customDurationSec >= 10) {
          timer.duration = customDurationSec;
        }
        timer.status = 'stopped';
        timer.accumulatedMs = 0;
        timer.lastStartedAt = null;
        break;
      }

      case 'setDuration': {
        if (typeof customDurationSec === 'number' && customDurationSec >= 10) {
          timer.duration = customDurationSec;
          timer.status = 'stopped';
          timer.accumulatedMs = 0;
          timer.lastStartedAt = null;
        }
        break;
      }

      default:
        break;
    }

    const payload = this.getSyncPayload(roomCode, now);
    if (this.onBroadcastSync) {
      this.onBroadcastSync(roomCode, payload);
    }
    return payload;
  }

  /**
   * Tính toán tổng mili-giây đã trôi qua chuẩn xác theo đồng hồ máy chủ
   */
  _getElapsedMs(timer, now = Date.now()) {
    let totalMs = timer.accumulatedMs;
    if (timer.status === 'running' && timer.lastStartedAt !== null) {
      totalMs += Math.max(0, now - timer.lastStartedAt);
    }
    return Math.min(timer.duration * 1000, totalMs);
  }

  /**
   * Xác định mức cảnh báo màu sắc cho màn hình Projector (xanh -> vàng 3' -> đỏ 1' -> hết giờ)
   */
  _getWarningLevel(remainingSec, status, elapsedSec) {
    if (remainingSec <= 0 && elapsedSec > 0) return 'ended';
    if (status === 'stopped' && elapsedSec === 0) return 'normal';
    if (remainingSec <= TIMER_WARNING_RED_SEC) return 'critical';     // <= 60s: nhấp nháy đỏ
    if (remainingSec <= TIMER_WARNING_YELLOW_SEC) return 'warning';   // <= 180s: màu vàng
    return 'normal';
  }

  /**
   * Xuất gói dữ liệu chuẩn theo PROTOCOL_SPEC.md cho sự kiện timer.sync
   */
  getSyncPayload(roomCode, now = Date.now()) {
    const timer = this.ensureTimer(roomCode);
    const elapsedMs = this._getElapsedMs(timer, now);
    const elapsed = Math.min(timer.duration, Math.floor(elapsedMs / 1000));
    const remaining = Math.max(0, timer.duration - elapsed);

    return {
      status: timer.status,
      duration: timer.duration,
      elapsed,
      remaining,
      warningLevel: this._getWarningLevel(remaining, timer.status, elapsed),
      serverTimestamp: now
    };
  }

  /**
   * Quét mỗi giây và phát đồng bộ cho các phòng có đồng hồ đang chạy
   */
  _tickAll() {
    const now = Date.now();
    for (const [roomCode, timer] of this.timers.entries()) {
      if (timer.status !== 'running') continue;

      const elapsedMs = this._getElapsedMs(timer, now);
      if (elapsedMs >= timer.duration * 1000) {
        timer.accumulatedMs = timer.duration * 1000;
        timer.lastStartedAt = null;
        timer.status = 'stopped';
      }

      if (this.onBroadcastSync) {
        this.onBroadcastSync(roomCode, this.getSyncPayload(roomCode, now));
      }
    }
  }
}

module.exports = TimerManager;
