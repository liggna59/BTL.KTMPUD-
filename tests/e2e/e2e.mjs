// Kiểm thử E2E 15 tiêu chí nghiệm thu (TC01–TC15) trên trình duyệt thật (Edge/Chrome).
// Chạy:  cd tests/e2e && npm install && npm test   (cần build trước: bin/BTKTPMUD.exe hoặc bin/BTKTPMUD)
// Biến môi trường tùy chọn: APP_EXE (đường dẫn file chạy), BROWSER_CHANNEL (msedge | chrome), E2E_PORT.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EXE = process.env.APP_EXE || path.join(ROOT, 'bin', process.platform === 'win32' ? 'BTKTPMUD.exe' : 'BTKTPMUD');
const SEED = path.join(ROOT, 'data');
const OUT = path.join(HERE, 'out');
const DATA = path.join(HERE, '.e2e-data');
const PORT = Number(process.env.E2E_PORT || 8091);
const BASE = `http://localhost:${PORT}`;
const CHANNEL = process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');

if (!fs.existsSync(EXE)) {
  console.error(`Không tìm thấy file chạy ${EXE}. Hãy build trước (build.bat hoặc ./build.sh).`);
  process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
for (const f of ['products_data.json', 'history_data.json']) fs.copyFileSync(path.join(SEED, f), path.join(DATA, f));

let server = null;
async function startServer() {
  server = spawn(EXE, ['-port', String(PORT), '-data', DATA, '-no-browser'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
async function stopServer() {
  server.kill();
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/health'); } catch { return; }
    await new Promise((r) => setTimeout(r, 100));
  }
}
const api = async (p, opts) => (await fetch(BASE + p, opts)).json();

const results = [];
function check(id, name, cond, detail = '') {
  results.push({ id, name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? '  — ' + detail : ''}`);
}

process.on('uncaughtException', async (e) => { console.log('CRASH', e.message); try { server.kill(); } catch {} process.exit(2); });
process.on('unhandledRejection', async (e) => { console.log('CRASH', e && e.message); try { await page.screenshot({ path: `${OUT}/crash.png` }); } catch {} try { server.kill(); } catch {} process.exit(2); });
await startServer();
const browser = await chromium.launch({ channel: CHANNEL, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/.test(m.text()) && pageErrors.push(m.text()));
page.on('dialog', (d) => { pageErrors.push('native dialog: ' + d.message()); d.dismiss(); });

const rows = () =>
  page.$$eval('#itemsBody tr', (trs) =>
    trs.map((tr) => ({
      name: tr.querySelector('[data-field=product_name]').value,
      unit: tr.querySelector('[data-field=unit]').value,
      qty: tr.querySelector('[data-field=quantity]').value,
      price: tr.querySelector('[data-field=unit_price]').value,
      total: tr.querySelector('.line-total').textContent,
      lump: tr.classList.contains('is-lump'),
      isNew: tr.classList.contains('is-new'),
    }))
  );
const cellSel = (i, f) => `#itemsBody tr[data-index="${i}"] [data-field="${f}"]`;
const activeField = () => page.evaluate(() => document.activeElement?.dataset?.field || document.activeElement?.id || '');
const stubPrint = () =>
  page.evaluate(() => {
    window.__printed = [];
    window.print = () => window.__printed.push(document.getElementById('print-area').innerHTML);
  });

// ---------------------------------------------------------------- TC01
const t0 = Date.now();
await page.goto(BASE);
await page.waitForSelector('#itemsBody tr');
await page.waitForFunction(() => window.App && App.state.products.length > 0);
const tab = await page.$eval('.tab.active', (e) => e.dataset.tab);
check('TC01', 'Khởi chạy: mở localhost hiển thị ngay tab Lập Hóa Đơn', tab === 'invoice' && (await page.isVisible('#tab-invoice')), `tab=${tab}, ${Date.now() - t0}ms`);
await page.screenshot({ path: `${OUT}/01-invoice-empty.png` });

// ---------------------------------------------------------------- TC02
await page.fill('#customerName', 'Anh Test E2E (Công trình 5)');
await page.click(cellSel(0, 'product_name'));
await page.locator(cellSel(0, 'product_name')).pressSequentially('Ống', { delay: 30 });
await page.waitForSelector('#acDropdown:not([hidden]) .ac-item');
const sugg = await page.$$eval('#acDropdown .ac-name', (els) => els.map((e) => e.textContent));
await page.screenshot({ path: `${OUT}/02-autocomplete.png` });
await page.keyboard.press('ArrowDown');
const chosen = sugg[1];
await page.keyboard.press('Enter');
let r = await rows();
const prod = await page.evaluate((n) => App.state.products.find((p) => p.name === n), chosen);
check(
  'TC02',
  'Autocomplete: gõ "Ống" gợi ý các loại ống, chọn bằng ↓ Enter tự điền ĐVT + Đơn giá, nhảy sang Số lượng',
  sugg.length >= 5 && sugg.slice(0, 5).every((s) => s.startsWith('Ống')) && r[0].name === chosen && r[0].unit === prod.unit &&
    r[0].price.replace(/\./g, '') === String(prod.selling_price) && (await activeField()) === 'quantity',
  `${sugg.length} gợi ý, chọn "${chosen}" -> ĐVT=${r[0].unit}, giá=${r[0].price}, focus=${await activeField()}`
);

// ---------------------------------------------------------------- TC03
await page.keyboard.type('5');
await page.keyboard.press('Enter'); // sang ô đơn giá
check('TC03a', 'Enter ở ô Số lượng nhảy sang ô Đơn giá', (await activeField()) === 'unit_price');
await page.keyboard.press('Control+A');
await page.keyboard.type('20000');
r = await rows();
check('TC03', 'Số lượng 5 × Đơn giá 20.000 → Thành tiền 100.000 tức thời', r[0].total === '100.000', `thành tiền = ${r[0].total}`);
await page.keyboard.press('Tab');
r = await rows();
check('TC03b', 'Đơn giá tự định dạng phân cách hàng nghìn khi rời focus', r[0].price === '20.000', r[0].price);

// ---------------------------------------------------------------- TC04
await page.keyboard.press('F2');
check('TC04a', 'F2 thêm dòng mới và focus vào ô Tên hàng', (await rows()).length === 2 && (await activeField()) === 'product_name');
await page.keyboard.type('Tiền công lắp đặt E2E đặc biệt');
await page.keyboard.press('Escape');
await page.click(cellSel(1, 'unit'));
await page.keyboard.type('gói');
await page.click(cellSel(1, 'unit_price'));
await page.keyboard.type('350000');
r = await rows();
check('TC04', 'Bán khoán: để trống Số lượng, Đơn giá 350.000 → Thành tiền 350.000, không báo lỗi', r[1].total === '350.000' && r[1].lump && r[1].qty === '', `total=${r[1].total}, tag Khoán=${r[1].lump}`);
check('TC07a', 'Hàng chưa có trong thư viện được đánh dấu "Mới"', r[1].isNew);

// ---------------------------------------------------------------- TC05
await page.keyboard.down('Control');
await page.keyboard.press('Enter');
await page.keyboard.up('Control');
await page.keyboard.type('xi mang hoang');
await page.waitForSelector('#acDropdown:not([hidden]) .ac-item');
await page.keyboard.press('Enter');
await page.keyboard.type('2');
r = await rows();
const total = await page.textContent('#totalAmount');
const words = await page.textContent('#totalWords');
check('TC05', 'Bảng 3 mặt hàng: Tổng cộng dồn đúng + Bằng chữ chuẩn có "đồng chẵn"', r.length === 3 && total === '640.000 đ' && words === 'Sáu trăm bốn mươi nghìn đồng chẵn', `${total} — "${words}"`);
await page.screenshot({ path: `${OUT}/03-invoice-filled.png` });

// ---------------------------------------------------------------- TC06
await page.click('#itemsBody tr[data-index="1"] [data-action="delete-row"]');
const afterDelete = (await rows()).length;
await page.keyboard.press('Control+z');
r = await rows();
const restoredRow = r.length === 3 && r[1].name === 'Tiền công lắp đặt E2E đặc biệt' && r[1].total === '350.000';
// sửa nhầm giá rồi hoàn tác
await page.click(cellSel(0, 'unit_price'));
await page.keyboard.press('Control+A');
await page.keyboard.type('99999');
const wrongTotal = await page.textContent('#totalAmount');
await page.keyboard.press('Control+z');
r = await rows();
const totalAfterUndo = await page.textContent('#totalAmount');
check(
  'TC06',
  'Hoàn tác Ctrl+Z: khôi phục dòng bị xóa nhầm và giá bị sửa nhầm',
  afterDelete === 2 && restoredRow && r[0].price.replace(/\./g, '') === '20000' && wrongTotal !== '640.000 đ' && totalAfterUndo === '640.000 đ',
  `xóa còn ${afterDelete} dòng → hoàn tác ${r.length} dòng; giá ${r[0].price}; tổng ${totalAfterUndo}`
);
// Nút Hoàn tác: lùi thêm 1 bước = bỏ số lượng "2" đã gõ ở dòng 3 (dòng 3 thành bán khoán)
await page.click('#btnUndo');
r = await rows();
const undoBtnWorks = r.length === 3 && r[2].qty === '' && r[2].lump;
await page.click(cellSel(2, 'quantity'));
await page.keyboard.type('2');
check('TC06b', 'Nút "Hoàn tác" trên thanh công cụ hoạt động', undoBtnWorks && (await page.textContent('#totalAmount')) === '640.000 đ', `dòng 3 sau hoàn tác: SL="${r[2].qty}"`);
await page.fill('#invoiceNote', 'Giao tại công trình ngõ 12');

// ---------------------------------------------------------------- TC07 + TC08
const beforeProducts = (await api('/api/products')).total;
await stubPrint();
await page.click('#btnSave');
await page.waitForSelector('.saved-dialog');
const savedId = await page.textContent('.saved-dialog .kv dd strong');
await page.screenshot({ path: `${OUT}/04-saved-dialog.png` });
const libAfter = await api('/api/products');
const synced = libAfter.data.find((p) => p.name === 'Tiền công lắp đặt E2E đặc biệt');
await page.click('.saved-dialog .btn-primary'); // In hóa đơn
const printed = await page.evaluate(() => window.__printed);
await page.click('.tab[data-tab="products"]');
await page.waitForSelector('#productTableBody tr');
const inLibraryTab = await page.$$eval('#productTableBody .c-name', (els, n) => els.some((e) => e.textContent.includes(n)), 'Tiền công lắp đặt E2E đặc biệt');
check(
  'TC07',
  'Lưu hóa đơn có hàng mới → hàng mới xuất hiện ngay trong tab Thư Viện',
  /^HD_AnhTestE2E_\d{8}_\d{4}$/.test(savedId) && synced && synced.unit === 'gói' && synced.selling_price === 350000 && libAfter.total === beforeProducts + 1 && inLibraryTab,
  `mã ${savedId}; thư viện ${beforeProducts} → ${libAfter.total}`
);
const savedInv = (await api('/api/invoices/' + savedId)).data;
check('TC07b', 'Server tính lại tiền & ghi đúng dòng bán khoán', savedInv.total_amount === 640000 && savedInv.items[1].quantity === null && savedInv.items[1].is_lump_sum === true && savedInv.amount_in_words === 'Sáu trăm bốn mươi nghìn đồng chẵn' && savedInv.note === 'Giao tại công trình ngõ 12');

// In: kiểm tra nội dung phiếu và bố cục in A4
const html = printed[0] || '';
await page.click('.tab[data-tab="invoice"]');
await page.evaluate(() => document.body.classList.add('printing-invoice'));
await page.emulateMedia({ media: 'print' });
const printVis = await page.evaluate(() => ({
  app: getComputedStyle(document.getElementById('app')).display,
  area: getComputedStyle(document.getElementById('print-area')).display,
  font: getComputedStyle(document.querySelector('.print-doc')).fontFamily,
}));
await page.setViewportSize({ width: 794, height: 1123 });
await page.screenshot({ path: `${OUT}/05-print-A4.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 900 });
await page.pdf({ path: `${OUT}/hoa-don-A4.pdf`, preferCSSPageSize: true, printBackground: true });
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => document.body.classList.remove('printing-invoice'));
const pdfBytes = fs.readFileSync(`${OUT}/hoa-don-A4.pdf`);
const pdfPages = (pdfBytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdfBytes.toString('latin1'));
check(
  'TC08',
  'In A4: gọi hộp thoại in, ẩn menu, có ngày tháng + chữ ký, khổ A4 dọc',
  printed.length === 1 && html.includes(savedId) && html.includes('Người bán hàng') && html.includes('Khách hàng') && /Ngày \d{2} tháng \d{2} năm \d{4}/.test(html) &&
    printVis.app === 'none' && printVis.area === 'block' && /Times New Roman/.test(printVis.font) && mediaBox && Math.abs(+mediaBox[1] - 595.92) < 2 && Math.abs(+mediaBox[2] - 842.88) < 2,
  `print() gọi ${printed.length} lần; #app=${printVis.app}; khổ ${mediaBox && mediaBox[1]}x${mediaBox && mediaBox[2]}pt; ${pdfPages} trang`
);

// ---------------------------------------------------------------- TC09
await page.click('.tab[data-tab="products"]');
await page.fill('#pfName', 'Keo silicon Apollo A300 E2E');
await page.fill('#pfUnit', 'tuýp');
await page.fill('#pfCost', '45000');
await page.fill('#pfSell', '60000');
const profit = await page.textContent('#pfProfit');
const rate = await page.textContent('#pfRate');
await page.screenshot({ path: `${OUT}/06-products-form.png` });
await page.click('#pfSubmit');
await page.waitForFunction(() => App.state.products.some((p) => p.name === 'Keo silicon Apollo A300 E2E'));
const created = (await api('/api/products')).data.find((p) => p.name === 'Keo silicon Apollo A300 E2E');
check('TC09', 'Thêm vật tư: tự tính lãi gộp & tỷ lệ lãi %, lưu thành công', profit === '15.000 đ' && rate === '33,33%' && created && created.cost_price === 45000, `lãi ${profit}, tỷ lệ ${rate}, mã ${created && created.id}`);

// ---------------------------------------------------------------- TC10
const t10 = Date.now();
await page.fill('#productSearch', 'keo silicon');
await page.waitForFunction(() => document.querySelectorAll('#productTableBody tr').length === 1, null, { timeout: 3000 }).catch(() => {});
const searchMs = Date.now() - t10;
const keoRows = await page.$$eval('#productTableBody .c-name', (e) => e.map((x) => x.textContent.trim()));
await page.screenshot({ path: `${OUT}/07a-search-keo.png` });
await page.fill('#productSearch', 'ong nhua');
await page.waitForTimeout(260);
const ongCount = await page.$$eval('#productTableBody tr', (t) => t.length);
await page.screenshot({ path: `${OUT}/07-products-search.png` });
await page.fill('#productSearch', '');
await page.waitForTimeout(260);
check('TC10', 'Tìm kiếm danh mục tức thời (debounce 200ms), gõ không dấu vẫn ra', searchMs < 1000 && keoRows.length === 1 && ongCount >= 5, `"keo silicon" → 1 dòng sau ${searchMs}ms; "ong nhua" → ${ongCount} dòng`);

// sửa vật tư
await page.click('#productTableBody tr:first-child [data-action="edit"]');
const editTitle = await page.textContent('#productFormTitle');
await page.click('#pfCancel');
check('TC09b', 'Nút Sửa nạp vật tư lên form, nút Hủy sửa hoạt động', /Sửa vật tư/.test(editTitle) && (await page.isHidden('#pfCancel')));

// ---------------------------------------------------------------- TC11
await page.click('.tab[data-tab="history"]');
await page.waitForSelector('#historyTableBody tr');
const allCount = await page.$$eval('#historyTableBody tr', (t) => t.length);
await page.fill('#historySearch', 'test e2e');
await page.waitForFunction(() => document.querySelectorAll('#historyTableBody tr').length === 1, null, { timeout: 3000 });
const byName = await page.$$eval('#historyTableBody tr', (t) => t.map((x) => x.dataset.id));
await page.fill('#historySearch', 'HD_ChiLan');
await page.waitForFunction(() => document.querySelectorAll('#historyTableBody tr').length === 1 && document.querySelector('#historyTableBody tr').dataset.id.startsWith('HD_ChiLan'), null, { timeout: 3000 });
await page.fill('#historySearch', '');
await page.fill('#historyDate', '2026-11-15');
await page.dispatchEvent('#historyDate', 'change');
await page.waitForTimeout(400);
const byDate = await page.$$eval('#historyTableBody tr', (t) => t.map((x) => x.dataset.id));
await page.click('#historyReset');
await page.waitForTimeout(400);
const resetCount = await page.$$eval('#historyTableBody tr', (t) => t.length);
await page.screenshot({ path: `${OUT}/08-history.png` });
check('TC11', 'Tra cứu lịch sử theo tên KH / mã HĐ / ngày, nút "Tất cả" bỏ lọc', byName.length === 1 && byName[0] === savedId && byDate.length === 1 && byDate[0].startsWith('HD_ChiLan') && resetCount === allCount && allCount === 5, `tất cả=${allCount}, theo tên=${byName}, theo ngày=${byDate}`);

// Xem chi tiết
await page.click(`#historyTableBody tr[data-id="${savedId}"] [data-action="view"]`);
await page.waitForSelector('.modal .paper-preview .print-doc');
await page.screenshot({ path: `${OUT}/09-view-modal.png` });
const viewOk = (await page.textContent('.modal .paper-preview')).includes('Tiền công lắp đặt E2E đặc biệt');
await page.keyboard.press('Escape');
check('TC11b', 'Nút Xem mở popup phiếu bán hàng chi tiết', viewOk);

// ---------------------------------------------------------------- TC12
await page.click(`#historyTableBody tr[data-id="${savedId}"] [data-action="reload"]`);
await page.waitForFunction(() => App.state.activeTab === 'invoice');
r = await rows();
const banner = await page.isVisible('#editBanner');
const custName = await page.inputValue('#customerName');
check('TC12', 'Nạp lại: chuyển sang tab Lập hóa đơn, nạp đủ danh sách hàng để sửa', r.length === 3 && r[1].lump && r[1].qty === '' && custName === 'Anh Test E2E (Công trình 5)' && banner, `${r.length} dòng, KH="${custName}", banner sửa=${banner}`);
await page.screenshot({ path: `${OUT}/10-reload-edit.png` });
// sửa số lượng và cập nhật đơn
await page.click(cellSel(2, 'quantity'));
await page.keyboard.press('Control+A');
await page.keyboard.type('3');
await page.click('#btnSave');
await page.waitForSelector('.saved-dialog');
await page.keyboard.press('Escape');
const updated = (await api('/api/invoices/' + savedId)).data;
const count12 = (await api('/api/invoices')).total;
check('TC12b', 'Cập nhật hóa đơn đã nạp lại (PUT): giữ mã, tính lại tổng', updated.total_amount === 735000 && !!updated.updated_at && count12 === 5, `tổng mới ${updated.total_amount}, số HĐ ${count12}`);

// ---------------------------------------------------------------- TC13
await page.click('.tab[data-tab="dashboard"]');
await page.waitForFunction(() => /đơn$/.test(document.querySelector('#statInvoices').textContent) && document.querySelector('#revenueChart svg'));
await page.waitForTimeout(300);
const stats = (await api('/api/stats')).data;
const cards = await page.evaluate(() => [statInvoices.textContent, statRevenue.textContent, statProducts.textContent]);
const fmt = (n) => new Intl.NumberFormat('vi-VN').format(n);
await page.hover('#revenueChart .hit[data-i="6"]');
await page.waitForTimeout(150);
const tipVisible = await page.isVisible('#revenueChart .chart-tooltip');
await page.screenshot({ path: `${OUT}/11-dashboard.png` });
check(
  'TC13',
  'Thống kê: đúng Tổng số hóa đơn, Tổng doanh thu, Tổng số mặt hàng',
  cards[0] === `${stats.invoice_count} đơn` && cards[1] === `${fmt(stats.total_revenue)} đ` && cards[2] === `${stats.product_count} sản phẩm` && stats.invoice_count === 5 && stats.product_count === 44,
  cards.join(' | ') + ` | tooltip=${tipVisible}`
);

// ---------------------------------------------------------------- TC14
const page2 = await ctx.newPage();
await page2.goto(BASE);
await page2.waitForFunction(() => window.App && App.state.products.length > 0);
async function fillOne(p, cust, name) {
  await p.evaluate(() => App.Invoice.newInvoice());
  await p.fill('#customerName', cust);
  await p.click(cellSel(0, 'product_name'));
  await p.keyboard.type(name);
  await p.keyboard.press('Escape');
  await p.click(cellSel(0, 'quantity'));
  await p.keyboard.type('1');
  await p.click(cellSel(0, 'unit_price'));
  await p.keyboard.type('10000');
}
await page.click('.tab[data-tab="invoice"]');
await fillOne(page, 'Tab Một', 'Hàng đồng thời A');
await fillOne(page2, 'Tab Hai', 'Hàng đồng thời B');
const before14 = (await api('/api/invoices')).total;
await Promise.all([page.click('#btnSave'), page2.click('#btnSave')]);
await Promise.all([page.waitForSelector('.saved-dialog'), page2.waitForSelector('.saved-dialog')]);
// thêm 30 request ghi đồng thời trực tiếp vào API
const burst = await Promise.all(
  Array.from({ length: 30 }, (_, i) =>
    api('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Burst ' + (i % 3), items: [{ product_name: 'Hàng burst ' + i, unit: 'cái', quantity: 1, unit_price: 1000 }] }) })
  )
);
const after14 = (await api('/api/invoices')).total;
const fileOk = (() => {
  try {
    const h = JSON.parse(fs.readFileSync(path.join(DATA, 'history_data.json'), 'utf8'));
    const p = JSON.parse(fs.readFileSync(path.join(DATA, 'products_data.json'), 'utf8'));
    return h.length === after14 && new Set(h.map((x) => x.id)).size === h.length && p.some((x) => x.name === 'Hàng burst 29');
  } catch (e) {
    return false;
  }
})();
check('TC14', '2 tab + 30 request lưu đồng thời: không ghi đè, không mất dữ liệu, file JSON hợp lệ', after14 === before14 + 32 && burst.every((b) => b.success) && fileOk, `${before14} → ${after14} hóa đơn`);
await page2.close();
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- TC15
// Chờ Service Worker cài xong để có app shell ngoại tuyến
await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
await page.evaluate(() => App.Invoice.newInvoice());
await stopServer();
await page.reload();
await page.waitForSelector('#itemsBody tr', { timeout: 10000 });
await page.waitForFunction(() => window.App && App.state.products.length > 0 && !App.Api.isOnline(), null, { timeout: 15000 });
const offlinePill = await page.textContent('#connStatus');
await page.click(cellSel(0, 'product_name'));
await page.keyboard.type('day dien');
await page.waitForSelector('#acDropdown:not([hidden]) .ac-item');
await page.keyboard.press('Enter');
await page.keyboard.type('3');
await page.fill('#customerName', 'Khách ngoại tuyến');
await page.click('#btnSave');
await page.waitForSelector('.saved-dialog');
const offlineTitle = await page.textContent('.modal-head h3');
await page.keyboard.press('Escape');
const bannerVisible = await page.isVisible('#offlineBanner');
const pending = await page.evaluate(() => App.Api.getPending().length);
await page.screenshot({ path: `${OUT}/12-offline.png` });
await page.click('.tab[data-tab="history"]');
await page.waitForSelector('#historyTableBody tr.row-pending');
await page.click('.tab[data-tab="dashboard"]');
await page.waitForSelector('#revenueChart svg');
const dashOffline = await page.textContent('#dashUpdated');
await startServer();
await page.waitForFunction(() => App.Api.getPending().length === 0, null, { timeout: 20000 });
const syncedInv = (await api('/api/invoices?search=ngoai tuyen')).data;
check(
  'TC15',
  'Ngắt backend: vẫn mở được trang, nạp thư viện từ LocalStorage, lưu tạm (cờ vàng) và tự đồng bộ khi có lại kết nối',
  /Ngoại tuyến/.test(offlinePill) && /ngoại tuyến/.test(offlineTitle) && bannerVisible && pending === 1 && /ngoại tuyến/.test(dashOffline) && syncedInv.length === 1,
  `pill="${offlinePill}", chờ=${pending}, sau khi bật lại server: ${syncedInv.map((x) => x.id)}`
);

// ---------------------------------------------------------------- Kiểm tra validation & mobile
await page.click('.tab[data-tab="invoice"]');
await page.evaluate(() => App.Invoice.newInvoice());
await page.click(cellSel(0, 'unit_price'));
await page.keyboard.type('5000');
await page.click('#btnSave');
await page.waitForTimeout(200);
const errRow = await page.$eval('#itemsBody tr[data-index="0"]', (tr) => tr.classList.contains('has-error'));
check('VAL', 'Lưu thiếu tên hàng: báo lỗi, đánh dấu dòng, không gửi lên server', errRow);
await page.evaluate(() => App.Invoice.newInvoice());

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, locale: 'vi-VN' });
const mp = await mobile.newPage();
await mp.goto(BASE);
await mp.waitForSelector('#itemsBody tr');
const overflows = {};
for (const t of ['invoice', 'products', 'history', 'dashboard']) {
  await mp.click(`.tab[data-tab="${t}"]`);
  await mp.waitForTimeout(500);
  overflows[t] = await mp.evaluate(() => document.documentElement.scrollWidth - 390);
  await mp.screenshot({ path: `${OUT}/13-mobile-${t}.png`, fullPage: true });
}
const overflow = Math.max(...Object.values(overflows));
await mobile.close();
check('MOB', 'Giao diện điện thoại (390px) không bị tràn ngang ở cả 4 tab', overflow <= 0, JSON.stringify(overflows));
await mobile.close();

await page.click('#btnSettings');
await page.fill('#setStoreName', 'CỬA HÀNG VẬT TƯ E2E MINH PHÁT');
await page.click('.modal .btn-primary');
await page.waitForFunction(() => document.querySelector('#brandStoreName').textContent === 'CỬA HÀNG VẬT TƯ E2E MINH PHÁT');
const savedSettings = (await api('/api/settings')).data;
check('SET', 'Cấu hình thông tin cửa hàng in trên hóa đơn', savedSettings.store_name === 'CỬA HÀNG VẬT TƯ E2E MINH PHÁT');

check('ERR', 'Không có lỗi JavaScript trên trang', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
await stopServer();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
