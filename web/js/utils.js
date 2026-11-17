/**
 * utils.js — Các thuật toán nghiệp vụ lõi & tiện ích dùng chung.
 * Chạy được cả trên trình duyệt (window.Utils) lẫn Node.js (module.exports) để kiểm thử tự động.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 5.1. Tính Thành tiền & xử lý Bán khoán trọn gói
  // ---------------------------------------------------------------------------

  /**
   * Tính thành tiền cho từng dòng hàng
   * @param {string|number|null} quantity - Số lượng (có thể null hoặc rỗng)
   * @param {number|string} unitPrice - Đơn giá
   * @returns {{ totalPrice: number, isLumpSum: boolean }}
   */
  function calculateLineItem(quantity, unitPrice) {
    const price = Number(unitPrice) || 0;

    // Nếu số lượng để trống hoặc null -> Tính theo hình thức BÁN KHOÁN
    if (quantity === null || quantity === undefined || String(quantity).trim() === '') {
      return { totalPrice: price, isLumpSum: true };
    }

    const qty = Number(String(quantity).replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      return { totalPrice: 0, isLumpSum: false };
    }

    return { totalPrice: Math.round(qty * price), isLumpSum: false };
  }

  // ---------------------------------------------------------------------------
  // 5.2. Đọc số tiền thành chữ tiếng Việt (đồng bộ 100% với bản Go phía server)
  // ---------------------------------------------------------------------------

  const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const GROUP_UNITS = ['', 'nghìn', 'triệu'];
  const BILLION = 1e9;

  function readThreeDigits(number, hasHigherGroup) {
    const hundred = Math.floor(number / 100);
    const remainder = number % 100;
    const ten = Math.floor(remainder / 10);
    const unit = remainder % 10;
    const w = [];

    if (hundred > 0 || hasHigherGroup) w.push(DIGITS[hundred], 'trăm');

    if (ten > 1) {
      w.push(DIGITS[ten], 'mươi');
      if (unit === 1) w.push('mốt');
      else if (unit === 5) w.push('lăm');
      else if (unit > 0) w.push(DIGITS[unit]);
    } else if (ten === 1) {
      w.push('mười');
      if (unit === 5) w.push('lăm');
      else if (unit > 0) w.push(DIGITS[unit]);
    } else if (unit > 0) {
      if (hundred > 0 || hasHigherGroup) w.push('lẻ');
      w.push(DIGITS[unit]);
    }
    return w;
  }

  function readBelowBillion(n, hasHigher) {
    const groups = [n % 1000, Math.floor(n / 1000) % 1000, Math.floor(n / 1e6)];
    const w = [];
    let started = hasHigher;
    for (let i = 2; i >= 0; i--) {
      if (groups[i] === 0) continue;
      w.push(...readThreeDigits(groups[i], started));
      if (GROUP_UNITS[i]) w.push(GROUP_UNITS[i]);
      started = true;
    }
    return w;
  }

  function readNumber(n, hasHigher) {
    if (n < BILLION) return readBelowBillion(n, hasHigher);
    const w = readNumber(Math.floor(n / BILLION), hasHigher);
    w.push('tỷ');
    const low = n % BILLION;
    if (low > 0) w.push(...readBelowBillion(low, true));
    return w;
  }

  /**
   * Đọc số tiền thành chữ: 1850000 -> "Một triệu tám trăm năm mươi nghìn đồng chẵn"
   * @param {number} amount
   * @returns {string}
   */
  function numberToVietnameseWords(amount) {
    const value = Number(amount);
    if (amount === null || amount === undefined || amount === '' || !isFinite(value)) return '';
    const n = Math.round(Math.abs(value));
    if (n === 0) return 'Không đồng chẵn';
    if (n > Number.MAX_SAFE_INTEGER) return '';
    let text = readNumber(n, false).join(' ');
    if (value < 0) text = 'âm ' + text;
    return text.charAt(0).toUpperCase() + text.slice(1) + ' đồng chẵn';
  }

  // ---------------------------------------------------------------------------
  // 5.3. Ngăn xếp Hoàn tác đa tầng (Undo Stack 50 bước)
  // ---------------------------------------------------------------------------

  class UndoManager {
    constructor(maxSteps = 50) {
      this.maxSteps = maxSteps;
      this.history = [];
    }

    // Đẩy trạng thái trước khi thay đổi vào stack
    pushState(tableState) {
      // Deep copy trạng thái để tránh tham chiếu
      const snapshot = JSON.parse(JSON.stringify(tableState));
      this.history.push(snapshot);
      if (this.history.length > this.maxSteps) {
        this.history.shift(); // Loại bỏ bước cũ nhất (FIFO)
      }
    }

    // Lấy lại trạng thái gần nhất
    undo() {
      if (this.history.length === 0) return null;
      return this.history.pop();
    }

    canUndo() {
      return this.history.length > 0;
    }

    get size() {
      return this.history.length;
    }

    clear() {
      this.history = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Định dạng & phân tích số tiền / số lượng
  // ---------------------------------------------------------------------------

  const moneyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
  const qtyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });

  /** 1850000 -> "1.850.000" */
  function formatMoney(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return moneyFmt.format(Math.round(v));
  }

  /** 1850000 -> "1.850.000 đ" */
  function formatCurrency(n) {
    return formatMoney(n) + ' đ';
  }

  /** 1.5 -> "1,5" */
  function formatQuantity(n) {
    if (n === null || n === undefined || n === '') return '';
    const v = Number(n);
    return isFinite(v) ? qtyFmt.format(v) : '';
  }

  /** Số rút gọn cho trục biểu đồ: 1500000 -> "1,5 tr" */
  function formatCompactMoney(n) {
    const v = Math.abs(Number(n) || 0);
    const sign = Number(n) < 0 ? '-' : '';
    if (v >= 1e9) return sign + qtyFmt.format(+(v / 1e9).toFixed(1)) + ' tỷ';
    if (v >= 1e6) return sign + qtyFmt.format(+(v / 1e6).toFixed(1)) + ' tr';
    if (v >= 1e3) return sign + qtyFmt.format(+(v / 1e3).toFixed(0)) + 'k';
    return sign + qtyFmt.format(v);
  }

  /**
   * Phân tích chuỗi tiền do thu ngân gõ. Trả về null nếu rỗng, NaN nếu không hợp lệ.
   *   "20.000" | "20,000" | "20000" -> 20000
   *   "20k" -> 20000 ; "1,5tr" | "1.5m" -> 1500000
   */
  function parseMoney(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    let s = String(input).trim().toLowerCase().replace(/\s+/g, '').replace(/(vnđ|vnd|đ)$/, '');
    if (s === '') return null;
    let multiplier = 1;
    if (/(tr|m)$/.test(s)) {
      multiplier = 1e6;
      s = s.replace(/(tr|m)$/, '');
    } else if (/k$/.test(s)) {
      multiplier = 1e3;
      s = s.replace(/k$/, '');
    }
    if (multiplier > 1) {
      s = s.replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
      return Math.round(parseFloat(s) * multiplier);
    }
    if (!/^[\d.,]+$/.test(s)) return NaN;
    // Không có hậu tố: dấu chấm/phẩy là phân cách hàng nghìn
    const digits = s.replace(/[.,]/g, '');
    if (digits === '') return NaN;
    return parseInt(digits, 10);
  }

  // ---------------------------------------------------------------------------
  // Xử lý chuỗi tiếng Việt
  // ---------------------------------------------------------------------------

  /** Bỏ dấu 1 ký tự (giữ nguyên độ dài để ánh xạ vị trí khi tô sáng kết quả tìm kiếm). */
  function foldChar(ch) {
    if (ch === 'đ' || ch === 'Đ') return 'd';
    return ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().charAt(0) || ch;
  }

  /** Chuẩn hóa để tìm kiếm không dấu, không phân biệt hoa thường: "Ống Nhựa" -> "ong nhua" */
  function normalizeText(s) {
    return String(s || '')
      .normalize('NFC')
      .split('')
      .map(foldChar)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Khóa so khớp tên hàng (giữ dấu): không phân biệt hoa thường & khoảng trắng thừa */
  function nameKey(s) {
    return String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Gộp khoảng trắng + chuẩn hóa Unicode NFC trước khi gửi lên server */
  function cleanText(s) {
    return String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  /**
   * Chấm điểm mức khớp của tên hàng với từ khóa (số càng nhỏ càng khớp), -1 nếu không khớp.
   * Hỗ trợ gõ không dấu và nhiều từ khóa: "ong 21" khớp "Ống nhựa Tiền Phong D21".
   */
  function matchScore(name, query) {
    const n = normalizeText(name);
    const q = normalizeText(query);
    if (!q) return -1;
    if (n.startsWith(q)) return 0;
    if (n.includes(' ' + q)) return 1;
    if (n.includes(q)) return 2;
    const tokens = q.split(' ').filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => n.includes(t))) return 3;
    return -1;
  }

  /** Tô sáng (bằng <mark>) các đoạn khớp từ khóa trong tên, đã escape HTML. */
  function highlightMatch(name, query) {
    const text = String(name || '');
    const folded = text.split('').map(foldChar).join('');
    const tokens = normalizeText(query).split(' ').filter(Boolean);
    const marks = new Array(text.length).fill(false);
    const whole = normalizeText(query);
    const tryMark = (needle) => {
      const i = folded.indexOf(needle);
      if (i >= 0) for (let k = i; k < i + needle.length; k++) marks[k] = true;
      return i >= 0;
    };
    if (!whole || !tryMark(whole)) tokens.forEach(tryMark);
    let out = '';
    let open = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] && !open) { out += '<mark>'; open = true; }
      if (!marks[i] && open) { out += '</mark>'; open = false; }
      out += escapeHtml(text[i]);
    }
    if (open) out += '</mark>';
    return out;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // Ngày giờ
  // ---------------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');

  /** Ngày hôm nay theo giờ máy: "YYYY-MM-DD" */
  function todayISO(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** "2026-11-16" -> "16/11/2026" */
  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  /** "2026-11-16" -> "Ngày 16 tháng 11 năm 2026" */
  function formatDateLong(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}` : 'Ngày ..... tháng ..... năm ..........';
  }

  /** ISO 8601 -> "16/11/2026 09:45" (giờ máy) */
  function formatDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** ISO 8601 có múi giờ của máy: "2026-11-16T09:45:12+07:00" */
  function nowISO(d = new Date()) {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${todayISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  /** Thứ trong tuần ngắn gọn: "2026-11-16" -> "T2" */
  function weekdayShort(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  }

  // ---------------------------------------------------------------------------
  // Khác
  // ---------------------------------------------------------------------------

  function debounce(fn, wait) {
    let t = null;
    let pending = null; // [this, args] của lần gọi đang chờ
    const run = () => {
      const call = pending;
      pending = null;
      t = null;
      if (call) fn.apply(call[0], call[1]);
    };
    const wrapped = function (...args) {
      pending = [this, args];
      clearTimeout(t);
      t = setTimeout(run, wait);
    };
    wrapped.cancel = () => {
      clearTimeout(t);
      pending = null;
    };
    /** Chạy ngay lần gọi đang chờ (nếu có). */
    wrapped.flush = () => {
      clearTimeout(t);
      run();
    };
    return wrapped;
  }

  /**
   * Chọn toàn bộ nội dung ô nhập NGAY khi focus (để gõ đè), không chờ khung hình sau —
   * tránh mất chữ số đầu khi thu ngân gõ nhanh. Chặn mouseup kế tiếp để click chuột
   * không làm mất vùng chọn.
   */
  function selectAllOnFocus(input) {
    if (!input || typeof input.select !== 'function') return;
    input.select();
    const keep = (e) => e.preventDefault();
    input.addEventListener('mouseup', keep, { once: true });
    setTimeout(() => input.removeEventListener('mouseup', keep), 400);
  }

  function deepCopy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /** Đọc/ghi localStorage an toàn (trình duyệt chặn bộ nhớ / chế độ ẩn danh). */
  const storage = {
    get(key, fallback = null) {
      try {
        const raw = root.localStorage && root.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        root.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        root.localStorage.removeItem(key);
      } catch (e) { /* bỏ qua */ }
    },
  };

  const Utils = {
    calculateLineItem,
    numberToVietnameseWords,
    UndoManager,
    formatMoney,
    formatCurrency,
    formatQuantity,
    formatCompactMoney,
    parseMoney,
    normalizeText,
    nameKey,
    cleanText,
    matchScore,
    highlightMatch,
    escapeHtml,
    todayISO,
    formatDate,
    formatDateLong,
    formatDateTime,
    nowISO,
    weekdayShort,
    debounce,
    selectAllOnFocus,
    deepCopy,
    storage,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
  } else {
    root.Utils = Utils;
  }
})(typeof window !== 'undefined' ? window : globalThis);
