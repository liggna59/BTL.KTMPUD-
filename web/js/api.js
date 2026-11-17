/**
 * api.js — API Client Service + LocalStorage Fallback (mục 5.5 đặc tả).
 *
 *  - Gọi REST API JSON tại cùng địa chỉ máy chủ.
 *  - GET /api/products thành công -> lưu bản sao 'cached_products'.
 *  - Lỗi mạng / backend tắt -> tự đọc từ localStorage, giao diện không bị treo.
 *  - Lưu hóa đơn khi mất kết nối -> xếp hàng 'offline_pending_invoices', hiện cờ vàng,
 *    tự động đẩy lên server khi có kết nối trở lại.
 */
(function (App, U) {
  'use strict';

  const KEYS = {
    products: 'cached_products',
    invoices: 'cached_invoices',
    details: 'cached_invoice_details',
    settings: 'cached_settings',
    stats: 'cached_stats',
    pending: 'offline_pending_invoices',
  };
  const REQUEST_TIMEOUT = 8000;

  /** Lỗi do không kết nối được máy chủ (khác với lỗi nghiệp vụ trả về từ API). */
  class NetworkError extends Error {
    constructor(message) {
      super(message || 'Không kết nối được máy chủ');
      this.name = 'NetworkError';
      this.isNetworkError = true;
    }
  }

  /** Lỗi nghiệp vụ do server trả về (400, 404, 409...). */
  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }

  let online = true;
  let syncing = false;
  let monitorTimer = null;

  function setOnline(value) {
    if (online === value) return;
    online = value;
    App.emit('connection:changed', { online });
    if (online) syncPending();
    scheduleMonitor();
  }

  async function request(method, url, body, timeout = REQUEST_TIMEOUT) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
    } catch (err) {
      setOnline(false);
      throw new NetworkError(err && err.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu' : undefined);
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // Phản hồi không phải JSON: thường do proxy/máy chủ khác chiếm cổng
      if (res.status >= 500 || res.status === 0) {
        setOnline(false);
        throw new NetworkError('Máy chủ không phản hồi đúng định dạng');
      }
    }
    setOnline(true);
    if (!res.ok || !data || data.success === false) {
      throw new ApiError((data && data.message) || `Lỗi máy chủ (HTTP ${res.status})`, res.status, data);
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Thư viện hàng hóa
  // ---------------------------------------------------------------------------

  async function getProducts() {
    try {
      const res = await request('GET', '/api/products');
      U.storage.set(KEYS.products, res.data);
      return { data: res.data, offline: false };
    } catch (err) {
      if (!err.isNetworkError) throw err;
      return { data: U.storage.get(KEYS.products, []), offline: true };
    }
  }

  const createProduct = (p) => request('POST', '/api/products', p);
  const updateProduct = (id, p) => request('PUT', '/api/products/' + encodeURIComponent(id), p);
  const deleteProduct = (id) => request('DELETE', '/api/products/' + encodeURIComponent(id));

  // ---------------------------------------------------------------------------
  // Hóa đơn
  // ---------------------------------------------------------------------------

  function filterLocal(list, { search, date }) {
    const q = U.normalizeText(search || '');
    return list.filter(
      (inv) =>
        (!date || inv.invoice_date === date) &&
        (!q || U.normalizeText(inv.customer_name).includes(q) || U.normalizeText(inv.id).includes(q))
    );
  }

  async function getInvoices(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.date) qs.set('date', params.date);
    try {
      const res = await request('GET', '/api/invoices' + (qs.toString() ? '?' + qs : ''));
      if (!params.search && !params.date) U.storage.set(KEYS.invoices, res.data);
      return { data: res.data, offline: false };
    } catch (err) {
      if (!err.isNetworkError) throw err;
      return { data: filterLocal(U.storage.get(KEYS.invoices, []), params), offline: true };
    }
  }

  function cacheDetail(inv) {
    const map = U.storage.get(KEYS.details, {});
    map[inv.id] = inv;
    const ids = Object.keys(map);
    if (ids.length > 150) ids.slice(0, ids.length - 150).forEach((id) => delete map[id]);
    U.storage.set(KEYS.details, map);
  }

  async function getInvoice(id) {
    const pending = getPending().find((p) => p.local.id === id);
    if (pending) return pending.local;
    try {
      const res = await request('GET', '/api/invoices/' + encodeURIComponent(id));
      cacheDetail(res.data);
      return res.data;
    } catch (err) {
      if (!err.isNetworkError) throw err;
      const cached = U.storage.get(KEYS.details, {})[id];
      if (cached) return cached;
      throw new NetworkError('Đang ngoại tuyến và hóa đơn này chưa được lưu sẵn trên máy');
    }
  }

  /**
   * Lưu hóa đơn (tạo mới hoặc cập nhật). Khi mất kết nối, hóa đơn được xếp hàng chờ đồng bộ.
   * @param {object} payload  dữ liệu gửi API
   * @param {object} localInvoice  bản hóa đơn đã tính sẵn ở client (để xem/in khi ngoại tuyến)
   * @param {string|null} updateId  mã hóa đơn cần cập nhật (null = tạo mới)
   */
  async function saveInvoice(payload, localInvoice, updateId = null) {
    try {
      const res = updateId
        ? await request('PUT', '/api/invoices/' + encodeURIComponent(updateId), payload)
        : await request('POST', '/api/invoices', payload);
      if (res.data) cacheDetail(res.data);
      return { ...res, offline: false };
    } catch (err) {
      if (!err.isNetworkError) throw err;
      const local = { ...localInvoice };
      if (!updateId) local.id = 'OFFLINE_' + Date.now();
      local.pending = true;
      const queue = getPending().filter((p) => !(updateId && p.updateId === updateId));
      queue.push({ payload, updateId, local, queued_at: U.nowISO() });
      U.storage.set(KEYS.pending, queue);
      App.emit('pending:changed', { count: queue.length });
      return {
        success: true,
        offline: true,
        invoice_id: local.id,
        total_amount: local.total_amount,
        amount_in_words: local.amount_in_words,
        data: local,
      };
    }
  }

  const deleteInvoice = (id) => request('DELETE', '/api/invoices/' + encodeURIComponent(id));

  function getPending() {
    return U.storage.get(KEYS.pending, []);
  }

  function removePending(localId) {
    const queue = getPending().filter((p) => p.local.id !== localId);
    U.storage.set(KEYS.pending, queue);
    App.emit('pending:changed', { count: queue.length });
  }

  /** Đẩy các hóa đơn ngoại tuyến lên server theo thứ tự đã lưu. */
  async function syncPending() {
    if (syncing) return;
    const queue = getPending();
    if (!queue.length) return;
    syncing = true;
    let synced = 0;
    const failed = [];
    try {
      for (const item of queue) {
        try {
          if (item.updateId) await request('PUT', '/api/invoices/' + encodeURIComponent(item.updateId), item.payload);
          else await request('POST', '/api/invoices', item.payload);
          removePending(item.local.id);
          synced++;
        } catch (err) {
          if (err.isNetworkError) break; // mất kết nối lần nữa -> thử lại sau
          failed.push({ item, message: err.message });
        }
      }
    } finally {
      syncing = false;
    }
    if (synced || failed.length) App.emit('pending:synced', { synced, failed });
  }

  // ---------------------------------------------------------------------------
  // Thống kê & cấu hình
  // ---------------------------------------------------------------------------

  async function getStats() {
    try {
      const res = await request('GET', '/api/stats');
      U.storage.set(KEYS.stats, res.data);
      return { data: res.data, offline: false };
    } catch (err) {
      if (!err.isNetworkError) throw err;
      return { data: null, offline: true };
    }
  }

  async function getSettings() {
    try {
      const res = await request('GET', '/api/settings');
      U.storage.set(KEYS.settings, res.data);
      return res.data;
    } catch (err) {
      return U.storage.get(KEYS.settings, null);
    }
  }

  async function saveSettings(s) {
    const res = await request('PUT', '/api/settings', s);
    U.storage.set(KEYS.settings, res.data);
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Giám sát kết nối: kiểm tra định kỳ, khi có mạng trở lại thì tự đồng bộ.
  // ---------------------------------------------------------------------------

  async function ping() {
    try {
      await request('GET', '/api/health', undefined, 3000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function scheduleMonitor() {
    clearTimeout(monitorTimer);
    monitorTimer = setTimeout(async () => {
      await ping();
      if (online && getPending().length) syncPending();
      scheduleMonitor();
    }, online ? 20000 : 4000);
  }

  window.addEventListener('online', () => ping());
  window.addEventListener('offline', () => setOnline(false));

  App.Api = {
    NetworkError,
    ApiError,
    isOnline: () => online,
    ping,
    startMonitor: scheduleMonitor,
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    getInvoices,
    getInvoice,
    saveInvoice,
    deleteInvoice,
    getPending,
    removePending,
    syncPending,
    getStats,
    getSettings,
    saveSettings,
    cachedInvoices: () => U.storage.get(KEYS.invoices, []),
  };
})(window.App, window.Utils);
