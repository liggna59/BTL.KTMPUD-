/**
 * dashboard.js — Bảng Điều Khiển Thống Kê Nhanh.
 *  - 3 thẻ: Tổng hóa đơn đã xuất, Tổng doanh thu, Tổng số mặt hàng trong thư viện.
 *  - Doanh thu 7 ngày gần nhất (biểu đồ cột SVG, có tooltip + bảng số liệu).
 *  - Top 5 mặt hàng có doanh thu cao nhất.
 *  - Khi ngoại tuyến: tự tính từ dữ liệu đã lưu trên máy.
 */
(function (App, U) {
  'use strict';

  const $ = App.$;
  let lastStats = null;
  let showTable = false;

  /** Tính thống kê tại client từ dữ liệu đã lưu (dùng khi mất kết nối). */
  function computeOffline() {
    const invoices = [...App.Api.getPending().map((p) => p.local), ...App.Api.cachedInvoices()];
    const today = U.todayISO();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ date: U.todayISO(d), revenue: 0, invoice_count: 0 });
    }
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    let revenue = 0;
    let todayCount = 0;
    let todayRevenue = 0;
    invoices.forEach((inv) => {
      const amount = Number(inv.total_amount) || 0;
      revenue += amount;
      if (inv.invoice_date === today) {
        todayCount++;
        todayRevenue += amount;
      }
      if (byDate[inv.invoice_date]) {
        byDate[inv.invoice_date].revenue += amount;
        byDate[inv.invoice_date].invoice_count++;
      }
    });
    return {
      invoice_count: invoices.length,
      total_revenue: revenue,
      product_count: App.state.products.length,
      today: { date: today, invoice_count: todayCount, revenue: todayRevenue },
      last_7_days: days,
      top_products: null,
    };
  }

  async function load() {
    $('#dashUpdated').textContent = 'Đang tải...';
    let data;
    let offline = false;
    try {
      const res = await App.Api.getStats();
      data = res.data;
      offline = res.offline;
    } catch (err) {
      App.ui.toast(err.message, 'error');
    }
    if (!data) {
      data = computeOffline();
      offline = true;
    }
    lastStats = data;
    render(data, offline);
  }

  function render(d, offline) {
    $('#statInvoices').textContent = `${d.invoice_count.toLocaleString('vi-VN')} đơn`;
    $('#statRevenue').textContent = U.formatCurrency(d.total_revenue);
    $('#statProducts').textContent = `${d.product_count.toLocaleString('vi-VN')} sản phẩm`;
    $('#statInvoicesSub').textContent = `Hôm nay: ${d.today.invoice_count} đơn`;
    $('#statRevenueSub').textContent = `Hôm nay: ${U.formatCurrency(d.today.revenue)}`;
    const avg = d.invoice_count ? d.total_revenue / d.invoice_count : 0;
    $('#statProductsSub').textContent = `Giá trị TB mỗi đơn: ${U.formatCurrency(avg)}`;
    $('#dashUpdated').innerHTML = offline
      ? '<i class="fa-solid fa-triangle-exclamation"></i> Số liệu ngoại tuyến (từ dữ liệu đã lưu trên máy)'
      : `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')}`;
    $('#dashUpdated').classList.toggle('warning-text', offline);

    renderChart(d.last_7_days);
    renderTop(d.top_products);
  }

  // ---------------------------------------------------------------------------
  // Biểu đồ doanh thu 7 ngày — 1 chuỗi số liệu, cột mảnh bo góc đầu cột,
  // lưới mảnh, nhãn trực tiếp chỉ cho cột cao nhất & hôm nay, tooltip khi rê / focus.
  // ---------------------------------------------------------------------------

  function niceStep(max, ticks = 4) {
    const raw = max / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  function longDay(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${U.formatDate(iso)}`;
  }

  function renderChart(days) {
    const host = $('#revenueChart');
    const tableHost = $('#revenueTable');
    const today = U.todayISO();
    const total7 = days.reduce((s, d) => s + d.revenue, 0);
    $('#chartTotal').textContent = U.formatCurrency(total7);

    tableHost.innerHTML = `<table class="data-table compact">
        <thead><tr><th>Ngày</th><th class="num">Số hóa đơn</th><th class="num">Doanh thu</th></tr></thead>
        <tbody>${days
          .map((d) => `<tr><td>${longDay(d.date)}${d.date === today ? ' <span class="tag">Hôm nay</span>' : ''}</td><td class="num">${d.invoice_count}</td><td class="num">${U.formatCurrency(d.revenue)}</td></tr>`)
          .join('')}</tbody></table>`;
    host.hidden = showTable;
    tableHost.hidden = !showTable;
    $('#chartToggle').innerHTML = showTable
      ? '<i class="fa-solid fa-chart-column"></i> Xem biểu đồ'
      : '<i class="fa-solid fa-table"></i> Xem dạng bảng';
    if (showTable) return;

    const W = Math.max(host.clientWidth || 600, 300);
    const H = 260;
    const pad = { top: 28, right: 12, bottom: 44, left: 56 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...days.map((d) => d.revenue), 0);
    const step = maxVal > 0 ? niceStep(maxVal) : 1e6;
    const yMax = maxVal > 0 ? Math.ceil(maxVal / step) * step : step * 4;
    const y = (v) => pad.top + innerH - (v / yMax) * innerH;
    const band = innerW / days.length;
    const barW = Math.min(24, band * 0.5);
    const maxIdx = maxVal > 0 ? days.findIndex((d) => d.revenue === maxVal) : -1;
    const todayIdx = days.findIndex((d) => d.date === today);

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Biểu đồ cột doanh thu 7 ngày gần nhất, tổng ${U.formatCurrency(total7)}">`;
    // Lưới & trục Y
    for (let v = 0; v <= yMax + 1e-6; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<line class="grid${v === 0 ? ' baseline' : ''}" x1="${pad.left}" x2="${W - pad.right}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="axis-label" x="${pad.left - 8}" y="${yy + 4}" text-anchor="end">${U.formatCompactMoney(v)}</text>`;
    }
    days.forEach((d, i) => {
      const cx = pad.left + band * i + band / 2;
      const x = cx - barW / 2;
      const top = y(d.revenue);
      const h = pad.top + innerH - top;
      const r = Math.min(4, h, barW / 2);
      if (d.revenue > 0) {
        // Cột bo góc 4px ở đầu cột, vuông ở đường gốc
        svg += `<path class="bar${i === todayIdx ? ' is-today' : ''}" data-i="${i}" d="M${x},${pad.top + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + innerH} Z"/>`;
      }
      if ((i === maxIdx || i === todayIdx) && d.revenue > 0) {
        svg += `<text class="value-label" x="${cx}" y="${top - 8}" text-anchor="middle">${U.formatCompactMoney(d.revenue)}</text>`;
      }
      const isToday = i === todayIdx;
      svg += `<text class="axis-label${isToday ? ' strong' : ''}" x="${cx}" y="${H - pad.bottom + 18}" text-anchor="middle">${isToday ? 'Hôm nay' : U.weekdayShort(d.date)}</text>`;
      svg += `<text class="axis-label muted" x="${cx}" y="${H - pad.bottom + 34}" text-anchor="middle">${d.date.slice(8, 10)}/${d.date.slice(5, 7)}</text>`;
      // Vùng rê chuột rộng hơn cột để dễ trỏ
      svg += `<rect class="hit" data-i="${i}" x="${pad.left + band * i}" y="${pad.top}" width="${band}" height="${innerH}" tabindex="0"
        aria-label="${longDay(d.date)}: doanh thu ${U.formatCurrency(d.revenue)}, ${d.invoice_count} hóa đơn"/>`;
    });
    svg += '</svg><div class="chart-tooltip" hidden></div>';
    host.innerHTML = svg;
    if (maxVal === 0) host.insertAdjacentHTML('beforeend', '<div class="chart-empty">Chưa có doanh thu trong 7 ngày qua</div>');

    const tip = host.querySelector('.chart-tooltip');
    const showTip = (i) => {
      const d = days[i];
      host.querySelectorAll('.bar').forEach((b) => b.classList.toggle('dim', Number(b.dataset.i) !== i));
      tip.innerHTML = `<div class="tt-title">${longDay(d.date)}</div>
        <div class="tt-row"><span class="tt-key"></span>Doanh thu <b>${U.formatCurrency(d.revenue)}</b></div>
        <div class="tt-row muted">${d.invoice_count} hóa đơn</div>`;
      tip.hidden = false;
      const cx = pad.left + band * i + band / 2;
      const scale = host.clientWidth / W;
      const tw = tip.offsetWidth;
      let left = cx * scale - tw / 2;
      left = Math.max(0, Math.min(left, host.clientWidth - tw));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, y(d.revenue) * scale - tip.offsetHeight - 12) + 'px';
    };
    const hideTip = () => {
      tip.hidden = true;
      host.querySelectorAll('.bar').forEach((b) => b.classList.remove('dim'));
    };
    host.querySelectorAll('.hit').forEach((el) => {
      const i = Number(el.dataset.i);
      el.addEventListener('mouseenter', () => showTip(i));
      el.addEventListener('focus', () => showTip(i));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('blur', hideTip);
    });
  }

  function renderTop(top) {
    const host = $('#topProducts');
    if (!top) {
      host.innerHTML = '<div class="empty-state small"><i class="fa-solid fa-plug-circle-xmark"></i><p>Cần kết nối máy chủ để xem thống kê theo mặt hàng.</p></div>';
      return;
    }
    if (!top.length) {
      host.innerHTML = '<div class="empty-state small"><i class="fa-solid fa-box-open"></i><p>Chưa có dữ liệu bán hàng.</p></div>';
      return;
    }
    const max = Math.max(...top.map((t) => t.revenue), 1);
    host.innerHTML = `<ol class="top-list">${top
      .map(
        (t, i) => `<li>
          <span class="rank">${i + 1}</span>
          <div class="top-main">
            <div class="top-line"><span class="top-name">${U.escapeHtml(t.name)}</span><span class="top-rev">${U.formatCurrency(t.revenue)}</span></div>
            <div class="top-bar" aria-hidden="true"><span style="width:${Math.max(2, (t.revenue / max) * 100).toFixed(1)}%"></span></div>
            <div class="top-sub muted">${t.quantity > 0 ? `Đã bán ${U.formatQuantity(t.quantity)} ${U.escapeHtml(t.unit)} · ` : ''}${t.lines} lượt trên hóa đơn</div>
          </div>
        </li>`
      )
      .join('')}</ol>`;
  }

  function init() {
    $('#dashRefresh').addEventListener('click', load);
    $('#chartToggle').addEventListener('click', () => {
      showTable = !showTable;
      if (lastStats) renderChart(lastStats.last_7_days);
    });
    window.addEventListener(
      'resize',
      U.debounce(() => {
        if (App.state.activeTab === 'dashboard' && lastStats) renderChart(lastStats.last_7_days);
      }, 150)
    );
    App.on('tab:shown', ({ tab }) => tab === 'dashboard' && load());
    App.on('data:refresh', () => App.state.activeTab === 'dashboard' && load());
  }

  App.Dashboard = { init, load };
})(window.App, window.Utils);
