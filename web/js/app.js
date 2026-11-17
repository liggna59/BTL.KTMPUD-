/**
 * app.js — Lõi ứng dụng: quản lý Tabs, State dùng chung, Event Listeners toàn cục,
 * hộp thoại (modal/confirm), thông báo (toast), trạng thái kết nối & cấu hình cửa hàng.
 * Được nạp NGAY SAU utils.js; App.init() chạy khi toàn bộ script đã sẵn sàng.
 */
(function (U) {
  'use strict';

  const listeners = {};

  const App = {
    state: {
      activeTab: 'invoice',
      products: [],
      settings: null,
    },

    // ----- Event bus -----
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    emit(event, payload) {
      (listeners[event] || []).forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error('[App] lỗi xử lý sự kiện', event, e);
        }
      });
    },
  };
  window.App = App;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  App.$ = $;
  App.$$ = $$;

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  const TABS = ['invoice', 'products', 'history', 'dashboard'];
  const TAB_TITLES = {
    invoice: 'Lập Hóa Đơn',
    products: 'Thư Viện Hàng Hóa',
    history: 'Lịch Sử Hóa Đơn',
    dashboard: 'Thống Kê Nhanh',
  };

  function switchTab(tab, { updateHash = true } = {}) {
    if (!TABS.includes(tab)) tab = 'invoice';
    const prev = App.state.activeTab;
    App.state.activeTab = tab;
    $$('.tab').forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
    document.title = TAB_TITLES[tab] + ' · Quản lý bán hàng vật tư';
    if (updateHash) {
      const hash = tab === 'invoice' ? '' : '#' + tab;
      if (location.hash !== hash) history.replaceState(null, '', location.pathname + hash);
    }
    App.ui.closeAutocomplete && App.ui.closeAutocomplete();
    App.emit('tab:shown', { tab, prev });
  }
  App.switchTab = switchTab;

  // ---------------------------------------------------------------------------
  // UI: toast, modal, confirm
  // ---------------------------------------------------------------------------

  const ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info',
  };

  function toast(message, type = 'info', { timeout = 3800, action } = {}) {
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML =
      `<i class="fa-solid ${ICONS[type] || ICONS.info}" aria-hidden="true"></i>` +
      `<div class="toast-msg">${U.escapeHtml(message)}</div>` +
      (action ? `<button type="button" class="toast-action">${U.escapeHtml(action.label)}</button>` : '') +
      `<button type="button" class="toast-close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>`;
    const close = () => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    if (action) {
      el.querySelector('.toast-action').addEventListener('click', () => {
        action.onClick();
        close();
      });
    }
    root.appendChild(el);
    while (root.children.length > 4) root.firstElementChild.remove();
    if (timeout) setTimeout(close, timeout);
    return close;
  }

  let modalStack = [];

  /**
   * Mở hộp thoại.
   * @param {{title:string, body:string|Node, actions?:Array, size?:'sm'|'md'|'lg', onClose?:Function, className?:string}} opts
   * @returns {{close:Function, el:HTMLElement}}
   */
  function modal(opts) {
    const root = $('#modalRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = `modal modal-${opts.size || 'md'} ${opts.className || ''}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', opts.title || 'Hộp thoại');
    dialog.innerHTML = `
      <div class="modal-head">
        <h3>${opts.titleHtml || U.escapeHtml(opts.title || '')}</h3>
        <button type="button" class="icon-btn modal-x" aria-label="Đóng (Esc)" title="Đóng (Esc)"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>`;
    const body = dialog.querySelector('.modal-body');
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    const prevFocus = document.activeElement;
    let closed = false;
    const close = (result) => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      modalStack = modalStack.filter((m) => m !== handle);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      if (opts.onClose) opts.onClose(result);
      if (prevFocus && document.contains(prevFocus) && typeof prevFocus.focus === 'function') prevFocus.focus();
    };

    const foot = dialog.querySelector('.modal-foot');
    let autoFocusBtn = null;
    (opts.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.className || 'btn-outline');
      b.innerHTML = (a.icon ? `<i class="fa-solid ${a.icon}" aria-hidden="true"></i> ` : '') + U.escapeHtml(a.label);
      b.addEventListener('click', async () => {
        if (a.onClick) {
          const keepOpen = await a.onClick(close, b);
          if (keepOpen === true) return;
        }
        close(a.value);
      });
      foot.appendChild(b);
      if (a.autofocus) autoFocusBtn = b;
    });
    if (!foot.children.length) foot.remove();

    dialog.querySelector('.modal-x').addEventListener('click', () => close(undefined));
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop && !opts.static) close(undefined);
    });
    backdrop.appendChild(dialog);
    root.appendChild(backdrop);
    document.body.classList.add('modal-open');

    const handle = { close, el: dialog, invoice: opts.invoice || null };
    modalStack.push(handle);
    setTimeout(() => {
      const target = autoFocusBtn || dialog.querySelector('[autofocus]') || dialog.querySelector('input, select, textarea') || foot.querySelector?.('button');
      if (target) target.focus();
    }, 30);
    return handle;
  }

  function confirmDialog(message, { title = 'Xác nhận', okLabel = 'Đồng ý', cancelLabel = 'Hủy', danger = false, icon } = {}) {
    return new Promise((resolve) => {
      modal({
        title,
        size: 'sm',
        body: `<div class="confirm-body"><i class="fa-solid ${icon || (danger ? 'fa-triangle-exclamation' : 'fa-circle-question')} confirm-icon ${danger ? 'danger' : ''}" aria-hidden="true"></i><p>${message}</p></div>`,
        actions: [
          { label: cancelLabel, className: 'btn-outline', value: false },
          { label: okLabel, className: danger ? 'btn-danger' : 'btn-primary', value: true, autofocus: true },
        ],
        onClose: (v) => resolve(v === true),
      });
    });
  }

  App.ui = {
    toast,
    modal,
    confirm: confirmDialog,
    topModal: () => modalStack[modalStack.length - 1] || null,
    closeTopModal: () => {
      const m = modalStack[modalStack.length - 1];
      if (m) m.close(undefined);
      return !!m;
    },
  };

  // ---------------------------------------------------------------------------
  // Trạng thái kết nối & hóa đơn chờ đồng bộ
  // ---------------------------------------------------------------------------

  function renderConnection() {
    const online = App.Api.isOnline();
    const pending = App.Api.getPending().length;
    const pill = $('#connStatus');
    pill.className = 'conn-pill ' + (online ? (pending ? 'syncing' : 'online') : 'offline');
    pill.querySelector('span').textContent = online
      ? pending
        ? `Đang đồng bộ ${pending} đơn`
        : 'Đã kết nối máy chủ'
      : 'Ngoại tuyến';
    pill.title = online ? 'Máy chủ đang hoạt động' : 'Mất kết nối máy chủ — dữ liệu đang lấy từ bộ nhớ máy';

    const banner = $('#offlineBanner');
    const show = !online || pending > 0;
    banner.hidden = !show;
    if (show) {
      banner.querySelector('.banner-text').innerHTML = online
        ? `<strong>Có ${pending} hóa đơn lưu ngoại tuyến</strong> đang chờ đẩy lên máy chủ.`
        : `<strong>Mất kết nối máy chủ — đang chạy chế độ ngoại tuyến.</strong> Dữ liệu lấy từ bộ nhớ máy; hóa đơn mới được lưu tạm${pending ? ` (<b>${pending}</b> đơn đang chờ)` : ''} và tự đồng bộ khi có kết nối.`;
    }
  }

  // ---------------------------------------------------------------------------
  // Thư viện sản phẩm dùng chung (phục vụ Autocomplete & tab Thư viện)
  // ---------------------------------------------------------------------------

  App.loadProducts = async function () {
    const res = await App.Api.getProducts();
    App.state.products = Array.isArray(res.data) ? res.data : [];
    App.emit('products:changed', { offline: res.offline });
    return App.state.products;
  };

  App.findProductByName = function (name) {
    const key = U.nameKey(name);
    if (!key) return null;
    return App.state.products.find((p) => U.nameKey(p.name) === key) || null;
  };

  // ---------------------------------------------------------------------------
  // Cấu hình cửa hàng (in trên đầu hóa đơn)
  // ---------------------------------------------------------------------------

  const DEFAULT_SETTINGS = {
    store_name: 'CỬA HÀNG VẬT TƯ XÂY DỰNG - ĐIỆN NƯỚC',
    address: '',
    phone: '',
    invoice_title: 'HÓA ĐƠN BÁN LẺ',
    footer_note: 'Cảm ơn quý khách đã mua hàng!',
  };

  App.getSettings = () => App.state.settings || DEFAULT_SETTINGS;

  async function loadSettings() {
    App.state.settings = (await App.Api.getSettings()) || DEFAULT_SETTINGS;
    renderBrand();
  }

  function renderBrand() {
    $('#brandStoreName').textContent = App.getSettings().store_name || '';
  }

  function openSettings() {
    const s = App.getSettings();
    const field = (id, label, value, ph) =>
      `<label class="field"><span>${label}</span><input id="${id}" value="${U.escapeHtml(value || '')}" placeholder="${ph}" maxlength="200"></label>`;
    const m = modal({
      title: 'Thông tin cửa hàng in trên hóa đơn',
      size: 'md',
      body: `<form id="settingsForm" class="form-stack">
          ${field('setStoreName', 'Tên cửa hàng', s.store_name, 'VD: CỬA HÀNG VẬT TƯ MINH PHÁT')}
          ${field('setAddress', 'Địa chỉ', s.address, 'VD: Số 12, đường Lê Lợi, TP. Thanh Hóa')}
          ${field('setPhone', 'Điện thoại', s.phone, 'VD: 0912 345 678')}
          ${field('setTitle', 'Tiêu đề hóa đơn', s.invoice_title, 'HÓA ĐƠN BÁN LẺ')}
          ${field('setFooter', 'Lời cảm ơn cuối hóa đơn', s.footer_note, 'Cảm ơn quý khách!')}
        </form>`,
      actions: [
        { label: 'Hủy', className: 'btn-outline' },
        {
          label: 'Lưu thông tin',
          icon: 'fa-floppy-disk',
          className: 'btn-primary',
          onClick: async (close, btn) => {
            btn.disabled = true;
            try {
              App.state.settings = await App.Api.saveSettings({
                store_name: $('#setStoreName').value,
                address: $('#setAddress').value,
                phone: $('#setPhone').value,
                invoice_title: $('#setTitle').value,
                footer_note: $('#setFooter').value,
              });
              renderBrand();
              toast('Đã lưu thông tin cửa hàng', 'success');
              return false;
            } catch (err) {
              toast(err.isNetworkError ? 'Không thể lưu khi đang ngoại tuyến' : err.message, 'error');
              btn.disabled = false;
              return true;
            }
          },
        },
      ],
    });
    m.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      m.el.querySelector('.btn-primary').click();
    });
  }

  // ---------------------------------------------------------------------------
  // Phím tắt toàn cục
  // ---------------------------------------------------------------------------

  function onGlobalKeydown(e) {
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    if (key === 'Escape') {
      if (App.ui.closeAutocomplete && App.ui.closeAutocomplete()) return;
      if (App.ui.closeTopModal()) {
        e.preventDefault();
        return;
      }
    }

    // Alt + 1..4: chuyển tab
    if (e.altKey && !ctrl && /^[1-4]$/.test(key)) {
      e.preventDefault();
      switchTab(TABS[Number(key) - 1]);
      return;
    }

    if (App.ui.topModal()) return; // đang mở hộp thoại: không xử lý phím tắt của trang

    // Phím tắt Ctrl + Z để Hoàn tác (trên màn hình Lập hóa đơn)
    if (ctrl && !e.shiftKey && key.toLowerCase() === 'z' && App.state.activeTab === 'invoice') {
      e.preventDefault();
      App.Invoice.triggerUndoAction();
      return;
    }
    // Phím tắt F2 hoặc Ctrl + Enter để Thêm dòng mới
    if (key === 'F2' || (ctrl && key === 'Enter')) {
      e.preventDefault();
      if (App.state.activeTab !== 'invoice') switchTab('invoice');
      App.Invoice.addNewRowAction();
      return;
    }
    // Ctrl + S: Lưu hóa đơn
    if (ctrl && key.toLowerCase() === 's' && App.state.activeTab === 'invoice') {
      e.preventDefault();
      App.Invoice.saveInvoice();
      return;
    }
    // Ctrl + P: In hóa đơn đang lập
    if (ctrl && key.toLowerCase() === 'p' && App.state.activeTab === 'invoice') {
      e.preventDefault();
      App.Invoice.printCurrent();
    }
  }

  // ---------------------------------------------------------------------------
  // Khởi động
  // ---------------------------------------------------------------------------

  App.init = async function () {
    $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    window.addEventListener('hashchange', () => switchTab(location.hash.slice(1), { updateHash: false }));
    document.addEventListener('keydown', onGlobalKeydown);
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnSyncNow').addEventListener('click', async () => {
      const ok = await App.Api.ping();
      if (ok) await App.Api.syncPending();
      else toast('Vẫn chưa kết nối được máy chủ', 'warning');
      renderConnection();
    });

    // Không để con lăn chuột vô tình đổi giá trị ô số đang focus
    document.addEventListener(
      'wheel',
      (e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'number' && document.activeElement === e.target) e.target.blur();
      },
      { passive: true }
    );

    App.on('connection:changed', ({ online }) => {
      renderConnection();
      if (online) {
        toast('Đã kết nối lại máy chủ', 'success');
        App.loadProducts();
        loadSettings();
        App.emit('data:refresh');
      } else {
        toast('Mất kết nối máy chủ — chuyển sang chế độ ngoại tuyến', 'warning', { timeout: 5000 });
      }
    });
    App.on('pending:changed', renderConnection);
    App.on('pending:synced', ({ synced, failed }) => {
      renderConnection();
      if (synced) {
        toast(`Đã đồng bộ ${synced} hóa đơn ngoại tuyến lên máy chủ`, 'success', { timeout: 5000 });
        App.loadProducts();
        App.emit('data:refresh');
      }
      failed.forEach((f) => toast(`Không đồng bộ được hóa đơn ${f.item.local.id}: ${f.message}`, 'error', { timeout: 8000 }));
    });

    App.Invoice.init();
    App.Products.init();
    App.History.init();
    App.Dashboard.init();

    switchTab(location.hash.slice(1) || 'invoice', { updateHash: false });

    await Promise.all([App.loadProducts(), loadSettings()]);
    renderConnection();
    App.Api.startMonitor();
    if (App.Api.isOnline()) App.Api.syncPending();

    // Service Worker: giúp mở được giao diện kể cả khi máy chủ đang tắt (TC15)
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  };

  document.addEventListener('DOMContentLoaded', () => App.init());
})(window.Utils);
