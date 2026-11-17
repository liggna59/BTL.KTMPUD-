/**
 * products.js — Quản lý Thư Viện Hàng Hóa dùng chung.
 *  - Form thêm / sửa vật tư, hiển thị trực tiếp Lãi gộp & Tỷ lệ lãi (%).
 *  - Tìm kiếm tức thời (debounce 200ms, gõ không dấu vẫn tìm được).
 *  - Bảng danh mục có sắp xếp theo cột, sửa, xóa.
 */
(function (App, U) {
  'use strict';

  const $ = App.$;
  let editingId = null;
  let query = '';
  let sort = { key: 'created_at', dir: 'desc' };

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------

  function readPrice(id) {
    const v = U.parseMoney($(id).value);
    return v === null ? null : v;
  }

  /** Tỷ lệ lãi trên giá vốn (markup) & trên giá bán (biên lợi nhuận). */
  function profitInfo(cost, sell) {
    const profit = (sell || 0) - (cost || 0);
    const onCost = cost > 0 ? (profit / cost) * 100 : null;
    const onSell = sell > 0 ? (profit / sell) * 100 : null;
    return { profit, onCost, onSell };
  }

  const pct = (v) => (v === null ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + '%');

  function updateProfitPreview() {
    const cost = readPrice('#pfCost');
    const sell = readPrice('#pfSell');
    const valid = !Number.isNaN(cost) && !Number.isNaN(sell);
    $('#pfCost').classList.toggle('invalid', Number.isNaN(cost) || cost < 0);
    $('#pfSell').classList.toggle('invalid', Number.isNaN(sell) || sell < 0);
    const box = $('#profitPreview');
    if (!valid || (cost === null && sell === null)) {
      box.className = 'profit-preview';
      $('#pfProfit').textContent = '0 đ';
      $('#pfRate').textContent = '—';
      $('#pfMargin').textContent = '—';
      return;
    }
    const { profit, onCost, onSell } = profitInfo(cost || 0, sell || 0);
    box.className = 'profit-preview ' + (profit < 0 ? 'negative' : profit > 0 ? 'positive' : '');
    $('#pfProfit').textContent = (profit < 0 ? '−' : '') + U.formatCurrency(Math.abs(profit));
    $('#pfRate').textContent = pct(onCost);
    $('#pfMargin').textContent = pct(onSell);
  }

  function formatPriceInput(e) {
    const v = U.parseMoney(e.target.value);
    if (v !== null && !Number.isNaN(v)) e.target.value = U.formatMoney(v);
  }

  function unformatPriceInput(e) {
    const v = U.parseMoney(e.target.value);
    if (v !== null && !Number.isNaN(v)) e.target.value = String(v);
    U.selectAllOnFocus(e.target);
  }

  function resetForm() {
    editingId = null;
    $('#productForm').reset();
    $('#productFormTitle').innerHTML = '<i class="fa-solid fa-square-plus" aria-hidden="true"></i> Thêm vật tư mới vào thư viện';
    $('#pfSubmitLabel').textContent = 'Thêm vào danh mục';
    $('#pfCancel').hidden = true;
    $('#productForm').classList.remove('editing');
    updateProfitPreview();
    renderTable();
  }

  function startEdit(id) {
    const p = App.state.products.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    $('#pfName').value = p.name;
    $('#pfUnit').value = p.unit;
    $('#pfCost').value = U.formatMoney(p.cost_price);
    $('#pfSell').value = U.formatMoney(p.selling_price);
    $('#productFormTitle').innerHTML = `<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Sửa vật tư <span class="code">${U.escapeHtml(p.id)}</span>`;
    $('#pfSubmitLabel').textContent = 'Lưu thay đổi';
    $('#pfCancel').hidden = false;
    $('#productForm').classList.add('editing');
    updateProfitPreview();
    renderTable();
    $('#productForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#pfName').focus();
  }

  async function onSubmit(e) {
    e.preventDefault();
    const name = U.cleanText($('#pfName').value);
    const unit = U.cleanText($('#pfUnit').value);
    const cost = readPrice('#pfCost');
    const sell = readPrice('#pfSell');
    const fail = (msg, sel) => {
      App.ui.toast(msg, 'error');
      $(sel).focus();
    };
    if (!name) return fail('Tên vật tư không được để trống', '#pfName');
    if (!unit) return fail('Đơn vị tính không được để trống', '#pfUnit');
    if (cost === null || Number.isNaN(cost) || cost < 0) return fail('Giá vốn nhập hàng phải là số ≥ 0', '#pfCost');
    if (sell === null || Number.isNaN(sell) || sell < 0) return fail('Giá bán ra phải là số ≥ 0', '#pfSell');

    if (!editingId) {
      const dup = App.findProductByName(name);
      if (dup) return fail(`"${dup.name}" đã có trong thư viện (mã ${dup.id})`, '#pfName');
    }
    if (sell < cost) {
      const ok = await App.ui.confirm('Giá bán đang <b>thấp hơn giá vốn</b> (bán lỗ). Bạn vẫn muốn lưu?', { title: 'Cảnh báo giá bán', okLabel: 'Vẫn lưu' });
      if (!ok) return;
    }

    const btn = $('#pfSubmit');
    btn.disabled = true;
    const body = { name, unit, cost_price: cost, selling_price: sell };
    try {
      const res = editingId ? await App.Api.updateProduct(editingId, body) : await App.Api.createProduct(body);
      App.ui.toast(res.message || 'Đã lưu mặt hàng', 'success');
      const wasEditing = !!editingId;
      await App.loadProducts();
      resetForm();
      if (!wasEditing) flashRow(res.data && res.data.id);
      $('#pfName').focus();
    } catch (err) {
      App.ui.toast(err.isNetworkError ? 'Đang ngoại tuyến — không thể sửa thư viện lúc này' : err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function removeProduct(id) {
    const p = App.state.products.find((x) => x.id === id);
    if (!p) return;
    const ok = await App.ui.confirm(
      `Xóa mặt hàng <b>${U.escapeHtml(p.name)}</b> (${U.escapeHtml(p.id)}) khỏi thư viện?<br><small>Các hóa đơn đã lập trước đó không bị ảnh hưởng.</small>`,
      { title: 'Xóa mặt hàng', okLabel: 'Xóa', danger: true }
    );
    if (!ok) return;
    try {
      const res = await App.Api.deleteProduct(id);
      App.ui.toast(res.message || 'Đã xóa mặt hàng', 'success');
      if (editingId === id) resetForm();
      await App.loadProducts();
    } catch (err) {
      App.ui.toast(err.isNetworkError ? 'Đang ngoại tuyến — không thể xóa lúc này' : err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Bảng danh mục
  // ---------------------------------------------------------------------------

  const SORTERS = {
    id: (p) => p.id,
    name: (p) => p.name,
    unit: (p) => p.unit,
    cost_price: (p) => p.cost_price,
    selling_price: (p) => p.selling_price,
    profit: (p) => p.selling_price - p.cost_price,
    created_at: (p) => p.created_at || '',
  };

  function filtered() {
    const q = U.normalizeText(query);
    let list = App.state.products.slice();
    if (q) {
      list = list.filter((p) => {
        const hay = U.normalizeText(`${p.name} ${p.id} ${p.unit}`);
        return q.split(' ').every((t) => hay.includes(t));
      });
    }
    const get = SORTERS[sort.key] || SORTERS.created_at;
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'vi', { numeric: true });
      return c * dir || a.name.localeCompare(b.name, 'vi');
    });
    return list;
  }

  /** Mặt hàng được thêm trong ngày hôm nay (theo giờ máy) -> gắn nhãn "Mới". */
  function isRecent(p) {
    const d = new Date(p.created_at || '');
    return !isNaN(d.getTime()) && U.todayISO(d) === U.todayISO();
  }

  function renderTable() {
    const list = filtered();
    const esc = U.escapeHtml;
    const total = App.state.products.length;
    $('#productCount').textContent = total;
    $('#productResultInfo').textContent = query ? `Tìm thấy ${list.length} / ${total} mặt hàng` : `${total} mặt hàng`;

    document.querySelectorAll('#productTable th[data-sort]').forEach((th) => {
      const active = th.dataset.sort === sort.key;
      th.classList.toggle('sorted', active);
      th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.sort-ico').className = 'sort-ico fa-solid ' + (active ? (sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort');
    });

    $('#productEmpty').hidden = list.length > 0;
    $('#productEmpty').innerHTML = total
      ? `<i class="fa-solid fa-magnifying-glass"></i><p>Không có mặt hàng nào khớp với "<b>${esc(query)}</b>"</p>`
      : `<i class="fa-solid fa-box-open"></i><p>Thư viện chưa có mặt hàng nào. Hãy thêm vật tư ở form phía trên.</p>`;

    $('#productTableBody').innerHTML = list
      .map((p, i) => {
        const { profit, onCost } = profitInfo(p.cost_price, p.selling_price);
        const noCost = !p.cost_price;
        return `<tr data-id="${esc(p.id)}" class="${p.id === editingId ? 'row-editing' : ''}">
          <td class="c-stt">${i + 1}</td>
          <td class="c-code"><span class="code">${esc(p.id)}</span></td>
          <td class="c-name">${query ? U.highlightMatch(p.name, query) : esc(p.name)}${isRecent(p) ? ' <span class="tag tag-new">Mới</span>' : ''}</td>
          <td>${esc(p.unit)}</td>
          <td class="num">${noCost ? '<span class="muted" title="Chưa có giá vốn — mặt hàng tự đồng bộ từ hóa đơn hoặc là dịch vụ">0 <i class="fa-solid fa-circle-info"></i></span>' : U.formatMoney(p.cost_price)}</td>
          <td class="num strong">${U.formatMoney(p.selling_price)}</td>
          <td class="num ${profit < 0 ? 'text-danger' : ''}">${profit < 0 ? '−' : ''}${U.formatMoney(Math.abs(profit))}<small class="muted"> ${noCost ? '' : '(' + pct(onCost) + ')'}</small></td>
          <td class="c-actions">
            <button type="button" class="btn btn-sm btn-outline" data-action="edit" title="Sửa mặt hàng"><i class="fa-solid fa-pen"></i> Sửa</button>
            <button type="button" class="btn btn-sm btn-ghost-danger" data-action="delete" title="Xóa mặt hàng"><i class="fa-solid fa-trash-can"></i> Xóa</button>
          </td>
        </tr>`;
      })
      .join('');
  }

  function flashRow(id) {
    if (!id) return;
    const tr = document.querySelector(`#productTableBody tr[data-id="${CSS.escape(id)}"]`);
    if (tr) {
      tr.classList.add('flash');
      tr.scrollIntoView({ block: 'nearest' });
      setTimeout(() => tr.classList.remove('flash'), 2000);
    }
  }

  function init() {
    $('#productForm').addEventListener('submit', onSubmit);
    $('#pfCancel').addEventListener('click', resetForm);
    ['#pfCost', '#pfSell'].forEach((sel) => {
      $(sel).addEventListener('input', updateProfitPreview);
      $(sel).addEventListener('blur', formatPriceInput);
      $(sel).addEventListener('focus', unformatPriceInput);
    });
    $('#productForm').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editingId) {
        e.stopPropagation();
        resetForm();
      }
    });

    const onSearch = U.debounce(() => {
      query = $('#productSearch').value.trim();
      renderTable();
    }, 200);
    $('#productSearch').addEventListener('input', onSearch);
    $('#productSearchClear').addEventListener('click', () => {
      $('#productSearch').value = '';
      query = '';
      renderTable();
      $('#productSearch').focus();
    });

    document.querySelectorAll('#productTable th[data-sort]').forEach((th) => {
      const toggle = () => {
        const key = th.dataset.sort;
        sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'unit' || key === 'id' ? 'asc' : 'desc' };
        renderTable();
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });

    $('#productTableBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      if (btn.dataset.action === 'edit') startEdit(id);
      if (btn.dataset.action === 'delete') removeProduct(id);
    });

    App.on('products:changed', renderTable);
    App.on('tab:shown', ({ tab }) => {
      if (tab === 'products') {
        App.loadProducts();
        setTimeout(() => $('#productSearch').focus(), 0);
      }
    });
    updateProfitPreview();
  }

  App.Products = { init, renderTable };
})(window.App, window.Utils);
