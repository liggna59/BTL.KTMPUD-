/**
 * invoice.js — Màn hình Lập Hóa Đơn Bán Lẻ (trọng tâm nghiệp vụ).
 *  - Bảng hóa đơn động, tính tiền theo thời gian thực, bán khoán khi để trống Số lượng.
 *  - Autocomplete tên hàng (phím ↑ ↓ Enter), tự điền ĐVT + Đơn giá, nhảy sang ô Số lượng.
 *  - Ngăn xếp Hoàn tác 50 bước (Ctrl + Z).
 *  - Lưu hóa đơn (kể cả ngoại tuyến), In A4, Nạp lại hóa đơn cũ để sửa.
 *  - Tự động sao lưu bản nháp vào localStorage để không mất dữ liệu khi lỡ tải lại trang.
 */
(function (App, U) {
  'use strict';

  const $ = App.$;
  const DRAFT_KEY = 'invoice_draft';
  const HEADER_FIELDS = { customerName: 'customer_name', invoiceDate: 'invoice_date', invoiceNote: 'note' };
  const ROW_ORDER = ['product_name', 'unit', 'quantity', 'unit_price'];

  const undoManager = new U.UndoManager(50);

  const emptyItem = () => ({ product_name: '', unit: '', quantity: '', unit_price: '' });
  const freshState = () => ({ customer_name: '', invoice_date: U.todayISO(), note: '', items: [emptyItem()] });

  /** Dữ liệu bảng hóa đơn (được chụp snapshot cho Undo). */
  let state = freshState();
  /** Thông tin phụ (không nằm trong Undo): đang sửa đơn nào, đã lưu thành mã nào. */
  let meta = { editingId: null, editingDate: null, savedId: null, savedSignature: null };
  /** Phiên chỉnh sửa 1 ô: chỉ đẩy 1 snapshot cho mỗi lần sửa 1 ô (không phải mỗi phím gõ). */
  let session = null;
  let saving = false;
  let tbody;

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  const snapshotState = () => U.deepCopy(state);
  const signature = () => JSON.stringify(state);
  const isFilled = (it) =>
    [it.product_name, it.unit, it.quantity, it.unit_price].some((v) => String(v === null || v === undefined ? '' : v).trim() !== '');
  const hasContent = () => !!(state.customer_name.trim() || state.note.trim() || state.items.some(isFilled));
  const isSavedUnchanged = () => !!meta.savedId && signature() === meta.savedSignature;

  function pushUndo(snapshot) {
    undoManager.pushState(snapshot);
    renderUndo();
  }

  function beginSession() {
    session = { snapshot: snapshotState(), pushed: false };
  }

  /** Gọi trước khi thay đổi dữ liệu do gõ phím: đẩy trạng thái TRƯỚC khi sửa vào Undo stack. */
  function touch() {
    if (!session) beginSession();
    if (!session.pushed) {
      pushUndo(session.snapshot);
      session.pushed = true;
    }
  }

  const saveDraft = U.debounce(() => {
    if (!hasContent() && !meta.editingId) {
      U.storage.remove(DRAFT_KEY);
      $('#draftStatus').textContent = '';
      return;
    }
    const at = U.nowISO();
    U.storage.set(DRAFT_KEY, { state, meta, saved_at: at });
    $('#draftStatus').innerHTML = `<i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> Đã tự sao lưu lúc ${at.slice(11, 19)}`;
  }, 400);

  function changed() {
    saveDraft();
    renderMeta();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function displayPrice(raw) {
    const v = U.parseMoney(raw);
    return v === null || Number.isNaN(v) ? String(raw || '') : U.formatMoney(v);
  }

  function rowHtml(it, i) {
    const esc = U.escapeHtml;
    return `<tr data-index="${i}" class="item-row">
      <td class="col-stt">${i + 1}</td>
      <td class="col-name"><div class="name-cell">
        <input class="cell-input" data-field="product_name" value="${esc(it.product_name)}" placeholder="Gõ tên hàng để tìm..." autocomplete="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="acDropdown" aria-label="Tên hàng hóa, vật tư dòng ${i + 1}" maxlength="200">
        <span class="new-badge" title="Mặt hàng mới — sẽ tự động thêm vào Thư viện khi lưu hóa đơn">Mới</span>
      </div></td>
      <td class="col-unit"><input class="cell-input" data-field="unit" value="${esc(it.unit)}" list="unitSuggestions" autocomplete="off" aria-label="Đơn vị tính dòng ${i + 1}" maxlength="30"></td>
      <td class="col-qty"><input class="cell-input num" data-field="quantity" type="number" step="any" min="0" inputmode="decimal" value="${esc(it.quantity)}" placeholder="Khoán" aria-label="Số lượng dòng ${i + 1} (để trống = bán khoán)"></td>
      <td class="col-price"><input class="cell-input num" data-field="unit_price" inputmode="numeric" value="${esc(displayPrice(it.unit_price))}" placeholder="0" autocomplete="off" aria-label="Đơn giá dòng ${i + 1}"></td>
      <td class="col-total num"><span class="lump-tag" title="Bán khoán trọn gói: Thành tiền = Đơn giá">Khoán</span><output class="line-total">0</output></td>
      <td class="col-act"><button type="button" class="icon-btn danger" data-action="delete-row" title="Xóa dòng ${i + 1}" aria-label="Xóa dòng ${i + 1}"><i class="fa-solid fa-trash-can"></i></button></td>
    </tr>`;
  }

  function renderHeader() {
    $('#customerName').value = state.customer_name;
    $('#invoiceDate').value = state.invoice_date;
    $('#invoiceNote').value = state.note;
  }

  /** true trong lúc vẽ lại bảng: bỏ qua focusout/input phát ra từ các ô cũ bị gỡ khỏi DOM. */
  let rendering = false;

  function renderRows() {
    rendering = true;
    try {
      tbody.innerHTML = state.items.map(rowHtml).join('');
    } finally {
      rendering = false;
    }
    state.items.forEach((_, i) => updateRowFlags(i));
  }

  /** Sự kiện đến từ ô nhập còn nằm trong bảng hiện tại (không phải ô cũ vừa bị vẽ lại)? */
  const isLiveCell = (inp) => !rendering && inp.isConnected && tbody.contains(inp);

  function render() {
    renderHeader();
    renderRows();
    calculateTotal();
    renderMeta();
    renderUndo();
  }

  function rowEl(i) {
    return tbody.querySelector(`tr[data-index="${i}"]`);
  }

  function cell(i, field) {
    return tbody.querySelector(`tr[data-index="${i}"] [data-field="${field}"]`);
  }

  function updateRowFlags(i) {
    const tr = rowEl(i);
    const it = state.items[i];
    if (!tr || !it) return;
    const name = it.product_name.trim();
    tr.classList.toggle('is-new', !!name && App.state.products.length > 0 && !App.findProductByName(name));
    const price = U.parseMoney(it.unit_price);
    cell(i, 'unit_price').classList.toggle('invalid', Number.isNaN(price) || price < 0);
  }

  function renderUndo() {
    const btn = $('#btnUndo');
    btn.disabled = !undoManager.canUndo();
    $('#undoCount').textContent = undoManager.size;
  }

  function renderMeta() {
    const editing = !!meta.editingId;
    const banner = $('#editBanner');
    banner.hidden = !editing;
    if (editing) {
      $('#editBannerText').innerHTML = `Đang sửa hóa đơn <strong>${U.escapeHtml(meta.editingId)}</strong>${
        meta.editingDate ? ` (lập ngày ${U.formatDate(meta.editingDate)})` : ''
      }. Bấm <b>Cập nhật hóa đơn</b> để ghi đè, hoặc <b>Lưu thành đơn mới</b>.`;
    }
    $('#btnSaveLabel').textContent = editing ? 'CẬP NHẬT HÓA ĐƠN' : 'LƯU HÓA ĐƠN';
    $('#btnSaveAsNew').hidden = !editing;

    const chip = $('#saveStatus');
    if (isSavedUnchanged()) {
      chip.className = 'status-chip saved';
      chip.innerHTML = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Đã lưu: ${U.escapeHtml(meta.savedId)}`;
    } else if (meta.savedId) {
      chip.className = 'status-chip dirty';
      chip.innerHTML = `<i class="fa-solid fa-pen" aria-hidden="true"></i> ${U.escapeHtml(meta.savedId)} — có thay đổi chưa lưu`;
    } else {
      chip.className = 'status-chip';
      chip.innerHTML = `<i class="fa-regular fa-file" aria-hidden="true"></i> Hóa đơn mới — chưa lưu`;
    }
  }

  // ---------------------------------------------------------------------------
  // Tính tiền theo thời gian thực
  // ---------------------------------------------------------------------------

  /** Tính lại thành tiền từng dòng + tổng tiền + đọc bằng chữ. Gọi ở MỌI sự kiện input. */
  function calculateTotal() {
    let total = 0;
    let lines = 0;
    let lumps = 0;
    state.items.forEach((it, i) => {
      const filled = isFilled(it);
      const price = U.parseMoney(it.unit_price);
      const safePrice = price === null || Number.isNaN(price) || price < 0 ? 0 : price;
      const { totalPrice, isLumpSum } = U.calculateLineItem(it.quantity, safePrice);
      // Chỉ coi là "bán khoán" khi đã nhập đơn giá (tránh gắn nhãn cho dòng đang gõ dở)
      const lump = filled && isLumpSum && price !== null;
      const tr = rowEl(i);
      if (tr) {
        tr.querySelector('.line-total').textContent = U.formatMoney(filled ? totalPrice : 0);
        tr.classList.toggle('is-lump', lump);
      }
      if (filled) {
        total += totalPrice;
        lines++;
        if (lump) lumps++;
      }
    });
    $('#totalAmount').textContent = U.formatCurrency(total);
    $('#totalWords').textContent = U.numberToVietnameseWords(total);
    $('#sumLines').textContent = lines;
    $('#sumLump').textContent = lumps;
    $('#itemCountLabel').textContent = `${lines} dòng hàng`;
    return total;
  }

  // ---------------------------------------------------------------------------
  // Thao tác bảng: thêm / xóa dòng, hoàn tác, làm mới
  // ---------------------------------------------------------------------------

  function focusCell(i, field, select = true) {
    const inp = cell(i, field);
    if (!inp) return;
    inp.focus();
    if (select && typeof inp.select === 'function') inp.select();
    inp.closest('tr').scrollIntoView({ block: 'nearest' });
  }

  /** Thêm dòng mới và focus vào ô Tên hàng (F2 / Ctrl + Enter). */
  function addNewRowAction() {
    const last = state.items[state.items.length - 1];
    if (last && !isFilled(last)) {
      focusCell(state.items.length - 1, 'product_name');
      return;
    }
    pushUndo(snapshotState());
    state.items.push(emptyItem());
    tbody.insertAdjacentHTML('beforeend', rowHtml(state.items[state.items.length - 1], state.items.length - 1));
    calculateTotal();
    changed();
    focusCell(state.items.length - 1, 'product_name');
  }

  function deleteRow(i) {
    if (!state.items[i]) return;
    pushUndo(snapshotState());
    session = null;
    state.items.splice(i, 1);
    if (!state.items.length) state.items.push(emptyItem());
    renderRows();
    calculateTotal();
    changed();
    focusCell(Math.min(i, state.items.length - 1), 'product_name', false);
  }

  function currentFocus() {
    const a = document.activeElement;
    if (!a) return null;
    if (a.dataset && a.dataset.field && a.closest('#itemsBody')) {
      return { row: Number(a.closest('tr').dataset.index), field: a.dataset.field };
    }
    if (HEADER_FIELDS[a.id]) return { id: a.id };
    return null;
  }

  function restoreFocus(f) {
    if (!f) return;
    if (f.id) {
      $('#' + f.id).focus();
      return;
    }
    if (state.items[f.row]) focusCell(f.row, f.field, false);
    else focusCell(state.items.length - 1, 'product_name', false);
  }

  /** Khôi phục trạng thái bảng trước thao tác gần nhất (Ctrl + Z). */
  function triggerUndoAction() {
    closeAutocomplete();
    const prev = undoManager.undo();
    if (!prev) {
      App.ui.toast('Không còn thao tác nào để hoàn tác', 'info', { timeout: 1800 });
      renderUndo();
      return;
    }
    const focus = currentFocus();
    state = prev;
    session = null;
    render();
    restoreFocus(focus);
    saveDraft();
    App.ui.toast(`Đã hoàn tác (còn ${undoManager.size} bước)`, 'info', { timeout: 1500 });
  }

  function resetForm() {
    state = freshState();
    meta = { editingId: null, editingDate: null, savedId: null, savedSignature: null };
    session = null;
    render();
    changed();
    $('#customerName').focus();
  }

  async function clearAction() {
    if (hasContent()) {
      const ok = await App.ui.confirm('Xóa toàn bộ thông tin khách hàng và các dòng hàng để lập hóa đơn mới?<br><small>Có thể bấm <b>Hoàn tác (Ctrl + Z)</b> nếu lỡ tay.</small>', {
        title: 'Làm mới bảng hóa đơn',
        okLabel: 'Làm mới',
        danger: true,
      });
      if (!ok) return;
      pushUndo(snapshotState());
    }
    resetForm();
    App.ui.toast('Đã làm mới bảng hóa đơn', 'info', { timeout: 1800 });
  }

  /** Lập đơn mới sau khi lưu (có thể hoàn tác). */
  function newInvoice() {
    if (hasContent()) pushUndo(snapshotState());
    resetForm();
  }

  // ---------------------------------------------------------------------------
  // Autocomplete tên hàng
  // ---------------------------------------------------------------------------

  const ac = { el: null, input: null, row: -1, results: [], active: -1 };

  function searchProducts(query) {
    return App.state.products
      .map((p) => ({ p, s: U.matchScore(p.name, query) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name, 'vi'))
      .slice(0, 12)
      .map((r) => r.p);
  }

  function openAutocomplete(input, row) {
    const q = input.value.trim();
    const results = q ? searchProducts(q) : [];
    if (!results.length) {
      closeAutocomplete();
      return;
    }
    ac.input = input;
    ac.row = row;
    ac.results = results;
    ac.active = 0;
    ac.el.innerHTML =
      `<div class="ac-head">${results.length} gợi ý · <kbd>↑</kbd><kbd>↓</kbd> chọn · <kbd>Enter</kbd> điền · <kbd>Esc</kbd> đóng</div>` +
      results
        .map(
          (p, k) => `<div class="ac-item" role="option" id="ac-opt-${k}" data-k="${k}">
            <div class="ac-name">${U.highlightMatch(p.name, q)}</div>
            <div class="ac-meta"><span class="ac-unit">${U.escapeHtml(p.unit)}</span><span class="ac-price">${U.formatMoney(p.selling_price)} đ</span></div>
          </div>`
        )
        .join('');
    ac.el.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlightActive();
    positionAutocomplete();
  }

  function positionAutocomplete() {
    if (!ac.input || ac.el.hidden) return;
    const r = ac.input.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 460), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    ac.el.style.width = width + 'px';
    ac.el.style.left = left + 'px';
    const below = window.innerHeight - r.bottom;
    const h = Math.min(ac.el.scrollHeight, 360);
    if (below < h + 12 && r.top > below) {
      ac.el.style.top = Math.max(8, r.top - h - 4) + 'px';
    } else {
      ac.el.style.top = r.bottom + 4 + 'px';
    }
  }

  function highlightActive() {
    Array.from(ac.el.querySelectorAll('.ac-item')).forEach((el, k) => {
      const on = k === ac.active;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
    if (ac.input) ac.input.setAttribute('aria-activedescendant', ac.active >= 0 ? 'ac-opt-' + ac.active : '');
  }

  /** Đóng gợi ý; trả về true nếu trước đó đang mở. */
  function closeAutocomplete() {
    if (!ac.el || ac.el.hidden) return false;
    ac.el.hidden = true;
    if (ac.input) {
      ac.input.setAttribute('aria-expanded', 'false');
      ac.input.removeAttribute('aria-activedescendant');
    }
    ac.input = null;
    ac.results = [];
    ac.active = -1;
    return true;
  }

  /** Chọn một mặt hàng gợi ý: điền Tên, ĐVT, Đơn giá rồi nhảy sang ô Số lượng. */
  function selectProduct(p) {
    const i = ac.row;
    if (!state.items[i]) return;
    touch();
    const it = state.items[i];
    it.product_name = p.name;
    it.unit = p.unit;
    it.unit_price = String(p.selling_price);
    cell(i, 'product_name').value = p.name;
    cell(i, 'unit').value = p.unit;
    cell(i, 'unit_price').value = U.formatMoney(p.selling_price);
    rowEl(i).classList.remove('has-error');
    closeAutocomplete();
    updateRowFlags(i);
    calculateTotal();
    changed();
    focusCell(i, 'quantity');
  }

  // ---------------------------------------------------------------------------
  // Sự kiện bảng hàng
  // ---------------------------------------------------------------------------

  function onRowFocusIn(e) {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.field) return;
    beginSession();
    if (inp.dataset.field === 'unit_price') {
      const i = Number(inp.closest('tr').dataset.index);
      const v = U.parseMoney(state.items[i].unit_price);
      if (v !== null && !Number.isNaN(v)) inp.value = String(v);
      U.selectAllOnFocus(inp);
    }
  }

  function onRowFocusOut(e) {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.field) return;
    if (!isLiveCell(inp)) return; // ô cũ bị gỡ khi vẽ lại bảng (VD: sau Ctrl+Z) — không ghi đè trạng thái mới
    const tr = inp.closest('tr');
    if (!tr) return;
    const i = Number(tr.dataset.index);
    const field = inp.dataset.field;
    if (field === 'unit_price' && state.items[i]) {
      const v = U.parseMoney(inp.value);
      if (v !== null && !Number.isNaN(v) && v >= 0) {
        if (state.items[i].unit_price !== String(v)) {
          state.items[i].unit_price = String(v);
          changed();
        }
        inp.value = U.formatMoney(v);
      }
    }
    if (field === 'product_name') {
      setTimeout(() => {
        if (ac.input === inp && document.activeElement !== inp) closeAutocomplete();
      }, 120);
    }
    updateRowFlags(i);
    session = null;
  }

  function onRowInput(e) {
    const inp = e.target;
    const field = inp.dataset && inp.dataset.field;
    if (!field || !isLiveCell(inp)) return;
    const i = Number(inp.closest('tr').dataset.index);
    const it = state.items[i];
    if (!it) return;
    touch();
    let value = inp.value;
    if (field === 'quantity' && inp.validity && inp.validity.badInput) value = '?';
    it[field] = value;
    inp.classList.toggle('invalid', field === 'quantity' && value === '?');
    rowEl(i).classList.remove('has-error');
    if (field === 'product_name') openAutocomplete(inp, i);
    if (field === 'unit_price') updateRowFlags(i);
    calculateTotal();
    changed();
  }

  function onRowKeydown(e) {
    const inp = e.target;
    const field = inp.dataset && inp.dataset.field;
    if (!field) return;
    const i = Number(inp.closest('tr').dataset.index);

    // Điều hướng trong danh sách gợi ý
    if (field === 'product_name' && ac.input === inp && !ac.el.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = ac.results.length;
        ac.active = e.key === 'ArrowDown' ? (ac.active + 1) % n : (ac.active - 1 + n) % n;
        highlightActive();
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && ac.active >= 0) {
        e.preventDefault();
        selectProduct(ac.results[ac.active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeAutocomplete();
        return;
      }
      if (e.key === 'Tab') closeAutocomplete();
    }

    if (field === 'product_name' && e.key === 'ArrowDown' && (ac.el.hidden || ac.input !== inp) && inp.value.trim()) {
      e.preventDefault();
      openAutocomplete(inp, i);
      return;
    }

    // Ctrl + Delete: xóa dòng hiện tại
    if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') {
      e.preventDefault();
      deleteRow(i);
      return;
    }

    // Enter: nhảy sang ô kế tiếp như bảng tính
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const k = ROW_ORDER.indexOf(field);
      if (k < ROW_ORDER.length - 1) {
        focusCell(i, ROW_ORDER[k + 1]);
      } else if (i < state.items.length - 1) {
        focusCell(i + 1, 'product_name');
      } else if (isFilled(state.items[i])) {
        inp.blur();
        addNewRowAction();
      }
    }
  }

  function onRowClick(e) {
    const btn = e.target.closest('[data-action="delete-row"]');
    if (btn) deleteRow(Number(btn.closest('tr').dataset.index));
  }

  function bindHeaderInputs() {
    Object.entries(HEADER_FIELDS).forEach(([id, key]) => {
      const el = $('#' + id);
      el.addEventListener('focus', beginSession);
      el.addEventListener('blur', () => (session = null));
      const handler = () => {
        if (state[key] === el.value) return;
        touch();
        state[key] = el.value;
        changed();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (id === 'customerName') $('#invoiceDate').focus();
          else if (id === 'invoiceDate') $('#invoiceNote').focus();
          else focusCell(0, 'product_name');
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Kiểm tra, lưu hóa đơn
  // ---------------------------------------------------------------------------

  function parseQty(raw) {
    const s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (s === '') return null;
    const n = Number(s.replace(',', '.'));
    return Number.isNaN(n) ? NaN : n;
  }

  function validate() {
    const items = [];
    const errors = [];
    state.items.forEach((it, i) => {
      if (!isFilled(it)) return;
      const name = U.cleanText(it.product_name);
      const price = U.parseMoney(it.unit_price);
      const qty = parseQty(it.quantity);
      let err = null;
      let field = null;
      if (!name) [err, field] = ['Chưa nhập tên hàng hóa, vật tư', 'product_name'];
      else if (price === null) [err, field] = ['Chưa nhập đơn giá', 'unit_price'];
      else if (Number.isNaN(price) || price < 0) [err, field] = ['Đơn giá không hợp lệ', 'unit_price'];
      else if (qty !== null && (Number.isNaN(qty) || qty < 0)) [err, field] = ['Số lượng không hợp lệ', 'quantity'];
      if (err) errors.push({ i, err, field });
      else items.push({ product_name: name, unit: U.cleanText(it.unit), quantity: qty, unit_price: price });
    });

    tbody.querySelectorAll('tr.has-error').forEach((tr) => tr.classList.remove('has-error'));
    errors.forEach(({ i, err }) => {
      const tr = rowEl(i);
      tr.classList.add('has-error');
      tr.title = err;
    });
    if (errors.length) {
      const first = errors[0];
      App.ui.toast(`Dòng ${first.i + 1}: ${first.err}` + (errors.length > 1 ? ` (và ${errors.length - 1} dòng lỗi khác)` : ''), 'error');
      focusCell(first.i, first.field);
      return null;
    }
    if (!items.length) {
      App.ui.toast('Hóa đơn chưa có dòng hàng nào — hãy nhập ít nhất 1 mặt hàng', 'error');
      focusCell(0, 'product_name');
      return null;
    }
    return items;
  }

  /** Dựng hóa đơn đầy đủ ngay tại client (dùng để in và lưu ngoại tuyến). */
  function buildLocalInvoice(items, id) {
    const lines = items.map((it, k) => {
      const { totalPrice, isLumpSum } = U.calculateLineItem(it.quantity, it.unit_price);
      return {
        line_number: k + 1,
        product_name: it.product_name,
        unit: it.unit,
        quantity: isLumpSum ? null : it.quantity,
        unit_price: it.unit_price,
        total_price: totalPrice,
        is_lump_sum: isLumpSum,
      };
    });
    const total = lines.reduce((s, l) => s + l.total_price, 0);
    return {
      id: id || null,
      customer_name: U.cleanText(state.customer_name) || 'Khách lẻ',
      invoice_date: state.invoice_date || U.todayISO(),
      items: lines,
      total_amount: total,
      amount_in_words: U.numberToVietnameseWords(total),
      note: U.cleanText(state.note),
      created_at: U.nowISO(),
    };
  }

  function buildPayload(items) {
    return {
      customer_name: U.cleanText(state.customer_name),
      invoice_date: state.invoice_date || U.todayISO(),
      items: items.map((it, k) => ({
        line_number: k + 1,
        product_name: it.product_name,
        unit: it.unit,
        quantity: it.quantity,
        unit_price: it.unit_price,
      })),
      note: U.cleanText(state.note),
    };
  }

  function setSaveBusy(busy) {
    ['#btnSave', '#btnSaveAsNew'].forEach((sel) => ($(sel).disabled = busy));
    $('#btnSave').classList.toggle('loading', busy);
  }

  /**
   * Lưu hóa đơn: tạo mới (POST) hoặc cập nhật đơn đang sửa (PUT).
   * @param {{asNew?: boolean}} opts asNew = true: luôn lưu thành đơn mới.
   */
  async function saveInvoice({ asNew = false } = {}) {
    if (saving) return;
    closeAutocomplete();
    // Chuẩn hóa ô đơn giá đang focus trước khi kiểm tra
    if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.field === 'unit_price') {
      document.activeElement.blur();
    }
    const items = validate();
    if (!items) return;
    const updateId = !asNew && meta.editingId ? meta.editingId : null;

    if (!updateId && isSavedUnchanged()) {
      const again = await App.ui.confirm(
        `Hóa đơn này đã được lưu với mã <b>${U.escapeHtml(meta.savedId)}</b>.<br>Bạn có muốn lưu thêm <b>một hóa đơn mới</b> giống hệt không?`,
        { title: 'Hóa đơn đã được lưu', okLabel: 'Lưu thêm bản mới' }
      );
      if (!again) return;
    }

    const payload = buildPayload(items);
    const local = buildLocalInvoice(items, updateId);
    saving = true;
    setSaveBusy(true);
    try {
      const res = await App.Api.saveInvoice(payload, local, updateId);
      meta.savedId = res.invoice_id;
      meta.savedSignature = signature();
      if (!updateId) {
        meta.editingId = null;
        meta.editingDate = null;
      }
      renderMeta();
      saveDraft();
      if (!res.offline) {
        await App.loadProducts();
        state.items.forEach((_, i) => updateRowFlags(i));
      }
      App.emit('invoice:saved', res);
      showSavedDialog(res, !!updateId);
    } catch (err) {
      App.ui.toast(err.message || 'Không lưu được hóa đơn', 'error', { timeout: 6000 });
    } finally {
      saving = false;
      setSaveBusy(false);
    }
  }

  function showSavedDialog(res, updated) {
    const inv = res.data;
    const synced = (res.synced_products || []).length;
    const esc = U.escapeHtml;
    if (res.offline) {
      App.ui.toast('Mất kết nối: hóa đơn đã được lưu tạm trên máy và sẽ tự đồng bộ', 'warning', { timeout: 6000 });
    } else {
      App.ui.toast(`${updated ? 'Đã cập nhật' : 'Đã lưu'} hóa đơn ${res.invoice_id}`, 'success');
    }
    App.ui.modal({
      title: res.offline ? 'Đã lưu tạm hóa đơn (ngoại tuyến)' : updated ? 'Đã cập nhật hóa đơn' : 'Đã lưu hóa đơn thành công',
      size: 'sm',
      className: 'saved-dialog',
      body: `<div class="saved-body ${res.offline ? 'offline' : ''}">
          <i class="fa-solid ${res.offline ? 'fa-cloud-arrow-up' : 'fa-circle-check'} saved-icon" aria-hidden="true"></i>
          <dl class="kv">
            <dt>Mã hóa đơn</dt><dd><strong>${esc(res.invoice_id)}</strong></dd>
            <dt>Khách hàng</dt><dd>${esc(inv.customer_name)}</dd>
            <dt>Tổng tiền</dt><dd class="saved-total">${U.formatCurrency(res.total_amount)}</dd>
            <dt>Bằng chữ</dt><dd><em>${esc(res.amount_in_words)}</em></dd>
          </dl>
          ${res.offline ? '<p class="note warning">Hóa đơn sẽ tự động được đẩy lên máy chủ khi có kết nối trở lại.</p>' : ''}
          ${synced ? `<p class="note info"><i class="fa-solid fa-boxes-stacked"></i> Đã tự động thêm <b>${synced}</b> mặt hàng mới vào Thư viện hàng hóa.</p>` : ''}
        </div>`,
      actions: [
        { label: 'Lập hóa đơn mới', icon: 'fa-file-circle-plus', className: 'btn-outline', onClick: () => newInvoice() },
        { label: 'In hóa đơn', icon: 'fa-print', className: 'btn-primary', autofocus: true, onClick: () => printInvoice(inv) },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Nạp lại hóa đơn cũ để sửa
  // ---------------------------------------------------------------------------

  async function loadInvoiceForEdit(inv) {
    if (hasContent() && !isSavedUnchanged()) {
      const ok = await App.ui.confirm(
        `Bảng hóa đơn hiện tại đang có dữ liệu chưa lưu.<br>Nạp hóa đơn <b>${U.escapeHtml(inv.id)}</b> sẽ thay thế dữ liệu này (có thể <b>Ctrl + Z</b> để lấy lại).`,
        { title: 'Nạp lại hóa đơn', okLabel: 'Nạp hóa đơn' }
      );
      if (!ok) return false;
    }
    if (hasContent()) pushUndo(snapshotState());
    state = {
      customer_name: inv.customer_name || '',
      invoice_date: inv.invoice_date || U.todayISO(),
      note: inv.note || '',
      items: (inv.items || []).map((it) => ({
        product_name: it.product_name || '',
        unit: it.unit || '',
        quantity: it.quantity === null || it.quantity === undefined ? '' : String(it.quantity),
        unit_price: String(it.unit_price ?? ''),
      })),
    };
    if (!state.items.length) state.items.push(emptyItem());
    meta = {
      editingId: inv.pending ? null : inv.id,
      editingDate: inv.invoice_date,
      savedId: inv.id,
      savedSignature: null,
    };
    meta.savedSignature = signature();
    session = null;
    App.switchTab('invoice');
    render();
    saveDraft();
    App.ui.toast(`Đã nạp hóa đơn ${inv.id} vào bảng để sửa`, 'success');
    focusCell(state.items.length - 1, 'product_name', false);
    return true;
  }

  function exitEditMode() {
    meta.editingId = null;
    meta.editingDate = null;
    meta.savedId = null;
    meta.savedSignature = null;
    renderMeta();
    saveDraft();
    App.ui.toast('Đã chuyển thành hóa đơn mới (dữ liệu trong bảng được giữ nguyên)', 'info');
  }

  // ---------------------------------------------------------------------------
  // In hóa đơn khổ A4
  // ---------------------------------------------------------------------------

  /** Dựng HTML phiếu in A4 cho một hóa đơn. */
  function renderInvoiceDocument(inv, settings) {
    const s = settings || App.getSettings();
    const esc = U.escapeHtml;
    const rows = (inv.items || [])
      .map(
        (it, k) => `<tr>
          <td class="c-stt">${k + 1}</td>
          <td class="c-name">${esc(it.product_name)}</td>
          <td class="c-unit">${esc(it.unit)}</td>
          <td class="c-qty">${it.is_lump_sum || it.quantity === null ? '<em>Khoán</em>' : U.formatQuantity(it.quantity)}</td>
          <td class="c-price">${U.formatMoney(it.unit_price)}</td>
          <td class="c-total">${U.formatMoney(it.total_price)}</td>
        </tr>`
      )
      .join('');
    const number = inv.id ? esc(inv.id) : '<span class="pd-blank">(chưa lưu)</span>';
    return `<article class="print-doc">
      <header class="pd-header">
        <div class="pd-store">
          <div class="pd-store-name">${esc(s.store_name)}</div>
          ${s.address ? `<div>${esc(s.address)}</div>` : ''}
          ${s.phone ? `<div>${esc(s.phone)}</div>` : ''}
        </div>
        <div class="pd-number">
          <div>Số: <strong>${number}</strong></div>
          ${inv.pending ? '<div class="pd-pending">(Lưu ngoại tuyến — chờ đồng bộ)</div>' : ''}
        </div>
      </header>
      <h1 class="pd-title">${esc(s.invoice_title || 'HÓA ĐƠN BÁN LẺ')}</h1>
      <div class="pd-date"><em>${U.formatDateLong(inv.invoice_date)}</em></div>
      <div class="pd-info">
        <div><span class="pd-label">Tên khách hàng:</span> <strong>${esc(inv.customer_name || 'Khách lẻ')}</strong></div>
        ${inv.note ? `<div><span class="pd-label">Ghi chú:</span> ${esc(inv.note)}</div>` : ''}
      </div>
      <table class="print-table">
        <thead><tr>
          <th class="c-stt">STT</th><th class="c-name">Tên hàng hóa, vật tư</th><th class="c-unit">ĐVT</th>
          <th class="c-qty">Số lượng</th><th class="c-price">Đơn giá (VNĐ)</th><th class="c-total">Thành tiền (VNĐ)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="5" class="pd-total-label">Tổng cộng tiền thanh toán</td>
          <td class="c-total pd-total">${U.formatMoney(inv.total_amount)}</td>
        </tr></tfoot>
      </table>
      <p class="pd-words">Số tiền viết bằng chữ: <em>${esc(inv.amount_in_words || U.numberToVietnameseWords(inv.total_amount))}.</em></p>
      <div class="signature-section">
        <div class="pd-sign">
          <div class="pd-sign-date">&nbsp;</div>
          <div class="pd-sign-role">Khách hàng</div>
          <div class="pd-sign-hint">(Ký, ghi rõ họ tên)</div>
        </div>
        <div class="pd-sign">
          <div class="pd-sign-date"><em>${U.formatDateLong(inv.invoice_date)}</em></div>
          <div class="pd-sign-role">Người bán hàng</div>
          <div class="pd-sign-hint">(Ký, ghi rõ họ tên)</div>
        </div>
      </div>
      ${s.footer_note ? `<div class="pd-footer">${esc(s.footer_note)}</div>` : ''}
    </article>`;
  }

  /** In một hóa đơn: đưa phiếu vào vùng in rồi mở hộp thoại in của trình duyệt. */
  function printInvoice(inv) {
    $('#print-area').innerHTML = renderInvoiceDocument(inv, App.getSettings());
    document.body.classList.add('printing-invoice');
    window.print();
  }

  /** In hóa đơn đang lập trên màn hình (nút IN HÓA ĐƠN / Ctrl + P). */
  function printCurrent() {
    closeAutocomplete();
    const items = state.items
      .filter(isFilled)
      .map((it) => {
        const price = U.parseMoney(it.unit_price);
        return {
          product_name: U.cleanText(it.product_name),
          unit: U.cleanText(it.unit),
          quantity: parseQty(it.quantity),
          unit_price: price === null || Number.isNaN(price) ? 0 : price,
        };
      })
      .filter((it) => it.product_name || it.unit_price);
    if (!items.length) {
      App.ui.toast('Hóa đơn chưa có dòng hàng nào để in', 'warning');
      return;
    }
    const inv = buildLocalInvoice(items, isSavedUnchanged() ? meta.savedId : null);
    if (!inv.id) App.ui.toast('Lưu ý: hóa đơn này chưa được lưu vào hệ thống', 'info');
    printInvoice(inv);
  }

  /** Khi người dùng in bằng menu trình duyệt: tự chọn nội dung phiếu in phù hợp. */
  function onBeforePrint() {
    if (document.body.classList.contains('printing-invoice')) return;
    const top = App.ui.topModal();
    if (top && top.invoice) {
      $('#print-area').innerHTML = renderInvoiceDocument(top.invoice, App.getSettings());
      document.body.classList.add('printing-invoice');
    } else if (App.state.activeTab === 'invoice' && state.items.some(isFilled)) {
      const items = validateQuietly();
      if (items.length) {
        $('#print-area').innerHTML = renderInvoiceDocument(buildLocalInvoice(items, isSavedUnchanged() ? meta.savedId : null), App.getSettings());
        document.body.classList.add('printing-invoice');
      }
    }
  }

  function validateQuietly() {
    return state.items.filter(isFilled).map((it) => {
      const price = U.parseMoney(it.unit_price);
      return {
        product_name: U.cleanText(it.product_name),
        unit: U.cleanText(it.unit),
        quantity: parseQty(it.quantity),
        unit_price: price === null || Number.isNaN(price) ? 0 : price,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Khởi tạo
  // ---------------------------------------------------------------------------

  function restoreDraft() {
    const d = U.storage.get(DRAFT_KEY);
    if (!d || !d.state || !Array.isArray(d.state.items)) return false;
    state = {
      customer_name: d.state.customer_name || '',
      invoice_date: d.state.invoice_date || U.todayISO(),
      note: d.state.note || '',
      items: d.state.items.length ? d.state.items.map((it) => ({ ...emptyItem(), ...it })) : [emptyItem()],
    };
    meta = { editingId: null, editingDate: null, savedId: null, savedSignature: null, ...(d.meta || {}) };
    if (hasContent() && !isSavedUnchanged()) {
      App.ui.toast(`Đã khôi phục hóa đơn đang lập dở (sao lưu lúc ${U.formatDateTime(d.saved_at)})`, 'info', { timeout: 5000 });
    }
    return true;
  }

  function refreshUnitSuggestions() {
    const base = ['cái', 'cây', 'cuộn', 'mét', 'bao', 'tấm', 'kg', 'khối', 'viên', 'bộ', 'hộp', 'gói', 'thùng', 'lít', 'm2', 'm3', 'tuýp', 'khoán'];
    const units = new Set(base);
    App.state.products.forEach((p) => p.unit && units.add(p.unit));
    $('#unitSuggestions').innerHTML = Array.from(units)
      .map((u) => `<option value="${U.escapeHtml(u)}"></option>`)
      .join('');
  }

  function init() {
    tbody = $('#itemsBody');
    ac.el = $('#acDropdown');
    App.ui.closeAutocomplete = closeAutocomplete;

    tbody.addEventListener('focusin', onRowFocusIn);
    tbody.addEventListener('focusout', onRowFocusOut);
    tbody.addEventListener('input', onRowInput);
    tbody.addEventListener('keydown', onRowKeydown);
    tbody.addEventListener('click', onRowClick);
    bindHeaderInputs();

    ac.el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // giữ focus ở ô nhập
      const item = e.target.closest('.ac-item');
      if (item) selectProduct(ac.results[Number(item.dataset.k)]);
    });
    ac.el.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.ac-item');
      if (item && Number(item.dataset.k) !== ac.active) {
        ac.active = Number(item.dataset.k);
        highlightActive();
      }
    });
    window.addEventListener('resize', positionAutocomplete);
    document.addEventListener('scroll', positionAutocomplete, true);
    document.addEventListener('mousedown', (e) => {
      if (ac.input && e.target !== ac.input && !ac.el.contains(e.target)) closeAutocomplete();
    });

    $('#btnAddRow').addEventListener('click', addNewRowAction);
    $('#btnUndo').addEventListener('click', triggerUndoAction);
    $('#btnClear').addEventListener('click', clearAction);
    $('#btnSave').addEventListener('click', () => saveInvoice());
    $('#btnSaveAsNew').addEventListener('click', () => saveInvoice({ asNew: true }));
    $('#btnPrint').addEventListener('click', printCurrent);
    $('#btnExitEdit').addEventListener('click', exitEditMode);

    // Ghi ngay bản nháp khi đóng / tải lại trang (không chờ hết thời gian debounce)
    window.addEventListener('pagehide', () => saveDraft.flush());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveDraft.flush());

    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-invoice'));

    App.on('products:changed', () => {
      state.items.forEach((_, i) => updateRowFlags(i));
      refreshUnitSuggestions();
    });
    App.on('tab:shown', ({ tab }) => {
      if (tab === 'invoice' && !document.activeElement.closest?.('#tab-invoice')) {
        // đặt con trỏ sẵn vào ô đầu tiên còn trống để thu ngân gõ ngay
        const idx = state.items.findIndex((it) => !isFilled(it));
        if (idx >= 0) setTimeout(() => focusCell(idx, 'product_name', false), 0);
      }
    });

    restoreDraft();
    render();
    if (!meta.savedSignature && !hasContent()) $('#draftStatus').textContent = '';
  }

  App.Invoice = {
    init,
    addNewRowAction,
    triggerUndoAction,
    calculateTotal,
    saveInvoice,
    printCurrent,
    printInvoice,
    renderInvoiceDocument,
    loadInvoiceForEdit,
    newInvoice,
    // phục vụ kiểm thử tự động
    _debug: () => ({ state: U.deepCopy(state), meta: { ...meta }, undo: undoManager.size }),
  };
})(window.App, window.Utils);
