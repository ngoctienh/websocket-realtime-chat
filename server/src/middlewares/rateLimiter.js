const { RATE_LIMIT } = require('../config/constants');

/**
 * Bộ giới hạn tần suất (Sliding Window Rate Limiter)
 * Bảo vệ WebSocket Server trước:
 * 1. Spam đặt câu hỏi (Tối đa 3 câu hỏi / phút / thiết bị)
 * 2. Flood frame WebSocket (Tối đa 120 bản tin / phút / kết nối)
 * 3. Tấn công dò mã PIN 4 số (Tối đa 10 lần nhập sai / phút / IP)
 */
class RateLimiter {
  constructor(options = {}) {
    this.config = {
      ...RATE_LIMIT,
      ...options
    };
    this.questionBuckets = new Map();
    this.messageBuckets = new Map();
    this.joinFailBuckets = new Map();
  }

  /**
   * Kiểm tra cửa sổ trượt chung cho một khóa định danh
   */
  _checkBucket(map, key, windowMs, maxCount, recordHit = true) {
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = map.get(key) || [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= maxCount) {
      map.set(key, timestamps);
      const oldest = timestamps[0];
      const retryAfterMs = Math.max(0, oldest + windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil(retryAfterMs / 1000) || 1
      };
    }

    if (recordHit) {
      timestamps.push(now);
    }
    map.set(key, timestamps);

    return {
      allowed: true,
      remaining: Math.max(0, maxCount - timestamps.length),
      retryAfterSec: 0
    };
  }

  /**
   * Giới hạn gửi câu hỏi: mặc định tối đa 3 câu hỏi / phút
   */
  checkQuestionLimit(clientKey) {
    return this._checkBucket(
      this.questionBuckets,
      clientKey,
      this.config.QUESTION_WINDOW_MS,
      this.config.MAX_QUESTIONS_PER_WINDOW,
      true
    );
  }

  /**
   * Giới hạn tổng số frame gửi lên từ 1 kết nối
   */
  checkMessageLimit(connectionKey) {
    return this._checkBucket(
      this.messageBuckets,
      connectionKey,
      this.config.MESSAGE_WINDOW_MS,
      this.config.MAX_MESSAGES_PER_WINDOW,
      true
    );
  }

  /**
   * Kiểm tra xem IP có đang bị khóa tạm thời do dò mã PIN sai nhiều lần không
   */
  isJoinBlocked(ip) {
    const res = this._checkBucket(
      this.joinFailBuckets,
      ip,
      this.config.JOIN_FAIL_WINDOW_MS,
      this.config.MAX_JOIN_FAILS_PER_WINDOW,
      false
    );
    return !res.allowed ? res : null;
  }

  /**
   * Ghi nhận 1 lần nhập sai mã PIN / sai host token theo IP
   */
  recordJoinFailure(ip) {
    return this._checkBucket(
      this.joinFailBuckets,
      ip,
      this.config.JOIN_FAIL_WINDOW_MS,
      this.config.MAX_JOIN_FAILS_PER_WINDOW,
      true
    );
  }

  /**
   * Dọn dẹp các khóa đã hết hạn để giải phóng RAM
   */
  cleanup() {
    const now = Date.now();
    const cleanMap = (map, windowMs) => {
      const cutoff = now - windowMs;
      for (const [key, list] of map.entries()) {
        const filtered = list.filter((t) => t > cutoff);
        if (filtered.length === 0) {
          map.delete(key);
        } else {
          map.set(key, filtered);
        }
      }
    };

    cleanMap(this.questionBuckets, this.config.QUESTION_WINDOW_MS);
    cleanMap(this.messageBuckets, this.config.MESSAGE_WINDOW_MS);
    cleanMap(this.joinFailBuckets, this.config.JOIN_FAIL_WINDOW_MS);
  }
}

module.exports = {
  RateLimiter,
  defaultRateLimiter: new RateLimiter()
};
