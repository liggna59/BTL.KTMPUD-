/**
 * history.js — Tra cứu & Quản lý Lịch Sử Hóa Đơn.
 *  - Lọc theo tên khách hàng / mã hóa đơn và theo ngày; nút "Tất cả" để bỏ lọc.
 *  - Xem chi tiết (popup), Nạp lại (Sửa), In, Xóa từng hóa đơn.
 *  - Hiển thị cả các hóa đơn lưu ngoại tuyến đang chờ đồng bộ.
 */
(function (App, U) {
  'use strict';

  const $ = App.$;
  let rows = [];
  let loading = false;
  let requestSeq = 0;

  function filters() {
    return { search: $('#historySearch').value.trim(), date: $('#historyDate').value };
  }

  function pendingRows({ search, date }) {
    const q = U.normalizeText(search);
    return App.Api.getPending()
      .map((p) => ({ ...p.local, items_count: (p.local.items || []).length, pending: true, update_of: p.updateId || null }))
      .filter(
        (inv) =>
          (!date || inv.invoice_date === date) &&
          (!q || U.normalizeText(inv.customer_name).includes(q) || U.normalizeText(inv.id).includes(q))
      );
  }

  async function load() {
    const seq = ++requestSeq;
    const f = filters();
    loading = true;
    $('#historyLoading').hidden = false;
    try {
      const res = await App.Api.getInvoices(f);
      if (seq !== requestSeq) return; // đã có yêu cầu mới hơn
      rows = [...pendingRows(f), ...res.data];
      $('#historyOfflineNote').hidden = !res.offline;
      render();
    } catch (err) {
      if (seq === requestSeq) App.ui.toast(err.message, 'error');
    } finally {
      if (seq === requestSeq) {
        loading = false;
        $('#historyLoading').hidden = true;
      }
    }
  }

  function render() {
    const esc = U.escapeHtml;
    const f = filters();
    const filtered = !!(f.search || f.date);
    const total = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    $('#historySummary').innerHTML = rows.length
      ? `<span><b>${rows.length}</b> hóa đơn${filtered ? ' khớp bộ lọc' : ''}</span><span>Tổng tiền: <b>${U.formatCurrency(total)}</b></span>`
      : '';
    $('#historyEmpty').hidden = rows.length > 0 || loading;
    $('#historyEmpty').innerHTML = filtered
      ? '<i class="fa-solid fa-filter-circle-xmark"></i><p>Không có hóa đơn nào khớp điều kiện lọc.</p>'
      : '<i class="fa-solid fa-receipt"></i><p>Chưa có hóa đơn nào. Hãy lập hóa đơn đầu tiên ở tab <b>Lập Hóa Đơn</b>.</p>';

    $('#historyTableBody').innerHTML = rows
      .map(
        (inv) => `<tr data-id="${esc(inv.id)}" class="${inv.pending ? 'row-pending' : ''}">
          <td class="c-code"><span class="code">${f.search ? U.highlightMatch(inv.id, f.search) : esc(inv.id)}</span>
            ${inv.pending ? `<span class="tag tag-warning" title="Lưu khi mất kết nối — sẽ tự đẩy lên máy chủ"><i class="fa-solid fa-cloud-arrow-up"></i> Chờ đồng bộ${inv.update_of ? ' (sửa ' + esc(inv.update_of) + ')' : ''}</span>` : ''}
            ${inv.updated_at ? '<span class="tag" title="Đã được sửa lúc ' + esc(U.formatDateTime(inv.updated_at)) + '">Đã sửa</span>' : ''}</td>
          <td>${f.search ? U.highlightMatch(inv.customer_name, f.search) : esc(inv.customer_name)}</td>
          <td class="nowrap">${U.formatDate(inv.invoice_date)}</td>
          <td class="num">${inv.items_count}</td>
          <td class="num strong">${U.formatMoney(inv.total_amount)}</td>
          <td class="nowrap muted">${U.formatDateTime(inv.created_at)}</td>
          <td class="c-actions">
            <button type="button" class="btn btn-sm btn-outline" data-action="view" title="Xem chi tiết"><i class="fa-solid fa-eye"></i> Xem</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="reload" title="Nạp lại vào bảng Lập hóa đơn để sửa"><i class="fa-solid fa-file-pen"></i> Nạp lại (Sửa)</button>
            <button type="button" class="btn btn-sm btn-outline" data-action="print" title="In hóa đơn"><i class="fa-solid fa-print"></i> In</button>
            <button type="button" class="btn btn-sm btn-ghost-danger" data-action="delete" title="Xóa hóa đơn"><i class="fa-solid fa-trash-can"></i> Xóa</button>
          </td>
        </tr>`
      )
      .join('');
  }

  async function fetchInvoice(id) {
    try {
      return await App.Api.getInvoice(id);
    } catch (err) {
      App.ui.toast(err.message, 'error');
      return null;
    }
  }

  async function view(id) {
    const inv = await fetchInvoice(id);
    if (!inv) return;
    const wrap = document.createElement('div');
    wrap.className = 'paper-preview';
    wrap.innerHTML = App.Invoice.renderInvoiceDocument(inv, App.getSettings());
    const meta = [
      `Tạo lúc ${U.formatDateTime(inv.created_at)}`,
      inv.updated_at ? `sửa lúc ${U.formatDateTime(inv.updated_at)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    App.ui.modal({
      titleHtml: `Hóa đơn <span class="code">${U.escapeHtml(inv.id)}</span> <small class="muted">${meta}</small>`,
      title: 'Chi tiết hóa đơn ' + inv.id,
      size: 'lg',
      body: wrap,
      invoice: inv,
      actions: [
        { label: 'Đóng', className: 'btn-outline' },
        { label: 'Nạp lại (Sửa)', icon: 'fa-file-pen', className: 'btn-outline', onClick: () => { App.Invoice.loadInvoiceForEdit(inv); } },
        { label: 'In hóa đơn', icon: 'fa-print', className: 'btn-primary', autofocus: true, onClick: () => { App.Invoice.printInvoice(inv); return true; } },
      ],
    });
  }

  async function reload(id) {
    const inv = await fetchInvoice(id);
    if (inv) await App.Invoice.loadInvoiceForEdit(inv);
  }

  async function print(id) {
    const inv = await fetchInvoice(id);
    if (inv) App.Invoice.printInvoice(inv);
  }

  async function remove(id) {
    const inv = rows.find((r) => r.id === id);
    if (!inv) return;
    const ok = await App.ui.confirm(
      `Hủy / xóa hóa đơn <b>${U.escapeHtml(id)}</b> của <b>${U.escapeHtml(inv.customer_name)}</b> (${U.formatCurrency(inv.total_amount)})?<br><small>Thao tác này không thể hoàn tác.</small>`,
      { title: 'Xóa hóa đơn', okLabel: 'Xóa hóa đơn', danger: true }
    );
    if (!ok) return;
    if (inv.pending) {
      App.Api.removePending(id);
      App.ui.toast('Đã xóa hóa đơn ngoại tuyến chưa đồng bộ', 'success');
      load();
      return;
    }
    try {
      const res = await App.Api.deleteInvoice(id);
      App.ui.toast(res.message || 'Đã xóa hóa đơn', 'success');
      load();
    } catch (err) {
      App.ui.toast(err.isNetworkError ? 'Đang ngoại tuyến — không thể xóa hóa đơn lúc này' : err.message, 'error');
    }
  }

  function init() {
    const debounced = U.debounce(load, 250);
    $('#historySearch').addEventListener('input', debounced);
    $('#historyDate').addEventListener('change', load);
    $('#historyReset').addEventListener('click', () => {
      $('#historySearch').value = '';
      $('#historyDate').value = '';
      load();
    });
    $('#historyToday').addEventListener('click', () => {
      $('#historyDate').value = U.todayISO();
      load();
    });
    $('#historyRefresh').addEventListener('click', load);

    $('#historyTableBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      ({ view, reload, print, delete: remove })[btn.dataset.action](id);
    });
    $('#historyTableBody').addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && !e.target.closest('button')) view(tr.dataset.id);
    });

    App.on('tab:shown', ({ tab }) => tab === 'history' && load());
    App.on('invoice:saved', () => App.state.activeTab === 'history' && load());
    App.on('pending:changed', () => App.state.activeTab === 'history' && load());
    App.on('data:refresh', () => App.state.activeTab === 'history' && load());
  }

  App.History = { init, load };
})(window.App, window.Utils);
