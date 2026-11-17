// Tạo sách hướng dẫn sử dụng: chụp ảnh màn hình có đánh số chú thích (docs/huong-dan/images/)
// rồi xuất docs/huong-dan/huong-dan.html thành docs/HUONG_DAN_SU_DUNG.pdf.
// Chạy:  cd tests/e2e && npm install && npm run guide          (cần build bin/BTKTPMUD.exe trước)
//        npm run guide -- --pdf-only                           (chỉ xuất lại PDF, không chụp lại ảnh)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EXE = process.env.APP_EXE || path.join(ROOT, 'bin', process.platform === 'win32' ? 'BTKTPMUD.exe' : 'BTKTPMUD');
const GUIDE_DIR = path.join(ROOT, 'docs', 'huong-dan');
const IMG = path.join(GUIDE_DIR, 'images');
const PDF = path.join(ROOT, 'docs', 'HUONG_DAN_SU_DUNG.pdf');
const DATA = path.join(HERE, '.guide-data');
const PORT = 8095;
const BASE = `http://localhost:${PORT}`;
const CHANNEL = process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
const pdfOnly = process.argv.includes('--pdf-only');

const browser = await chromium.launch({ channel: CHANNEL, headless: true });

if (!pdfOnly) await captureScreens();
await buildPdf();
await browser.close();
console.log('Đã tạo', PDF);

// ---------------------------------------------------------------------------

async function captureScreens() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of ['products_data.json', 'history_data.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(DATA, f));
  fs.mkdirSync(IMG, { recursive: true });

  const server = spawn(EXE, ['-port', String(PORT), '-data', DATA, '-no-browser'], { stdio: 'ignore' });
  await waitFor(async () => (await fetch(BASE + '/api/health')).ok);
  await fetch(BASE + '/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_name: 'CỬA HÀNG VẬT TƯ MINH PHÁT',
      address: 'Địa chỉ: Số 12 đường Lê Lợi, phường Điện Biên, TP. Thanh Hóa',
      phone: 'Điện thoại: 0912 345 678',
      invoice_title: 'HÓA ĐƠN BÁN LẺ',
      footer_note: 'Cảm ơn quý khách đã mua hàng!',
    }),
  });

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, locale: 'vi-VN' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.App && App.state.products.length > 0);
  const shot = async (name, opts = {}) => {
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(IMG, name), ...opts });
    await page.evaluate(() => document.getElementById('__ann')?.remove());
  };
  const cell = (i, f) => `#itemsBody tr[data-index="${i}"] [data-field="${f}"]`;
  const pick = async (text, qty) => {
    await page.keyboard.type(text);
    await page.waitForSelector('#acDropdown:not([hidden]) .ac-item');
    await page.keyboard.press('Enter');
    if (qty) await page.keyboard.type(qty);
  };

  // --- Lập hóa đơn
  await page.fill('#customerName', 'Anh Tuấn (Công trình nhà ông Bảy)');
  await page.fill('#invoiceNote', 'Giao hàng tại ngõ 25 Trần Phú trước 16h');
  await page.click(cell(0, 'product_name'));
  await pick('xi mang hoang', '20');
  await page.keyboard.press('F2');
  await pick('cat vang', '2');
  await page.keyboard.press('F2');
  await pick('ong nhua d21', '10');
  await page.keyboard.press('F2');
  await page.keyboard.type('Công lắp đặt bồn nước inox');
  await page.keyboard.press('Escape');
  await page.click(cell(3, 'unit'));
  await page.keyboard.type('gói');
  await page.click(cell(3, 'unit_price'));
  await page.keyboard.type('500k');
  await page.click('.summary-label');

  await annotate(page, [
    { sel: '.tabs', n: 1 },
    { sel: '#connStatus', n: 2, pos: 'l' },
    { sel: '#btnSettings', n: 3, pos: 'b' },
    { sel: '.invoice-main > section:nth-child(1)', n: 4 },
    { sel: '#itemsTable', n: 5 },
    { sel: '.action-bar', n: 6 },
    { sel: '.summary-box', n: 7, pos: 'l' },
    { sel: '#btnSave', n: 8, pos: 'l' },
    { sel: '#btnPrint', n: 9, pos: 'l' },
  ]);
  await shot('01-giao-dien-chinh.png');

  const itemsCard = await box(page, '.invoice-main > section:nth-child(2)');
  await annotate(page, [
    { sel: '#itemsBody tr[data-index="3"] .new-badge', n: 1, pad: 3, pos: 'l' },
    { sel: '#itemsBody tr[data-index="3"] [data-field="quantity"]', n: 2, pad: 2 },
    { sel: '#itemsBody tr[data-index="3"] .lump-tag', n: 3, pad: 3 },
  ]);
  await shot('03-hang-moi-ban-khoan.png', { clip: pad(itemsCard, 6) });

  await page.keyboard.press('F2');
  await page.keyboard.type('ong nhua');
  await page.waitForSelector('#acDropdown:not([hidden]) .ac-item');
  const dd = await box(page, '#acDropdown');
  await shot('02-goi-y-hang.png', { clip: { x: itemsCard.x - 6, y: itemsCard.y - 6, width: itemsCard.width + 12, height: dd.y + dd.height - itemsCard.y + 18 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Delete');

  // --- Lưu & in
  await page.evaluate(() => { window.print = () => {}; });
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.saved-dialog');
  const savedId = await page.textContent('.saved-dialog .kv dd strong');
  await shot('04-luu-thanh-cong.png', { clip: pad(await box(page, '.saved-dialog'), 10) });
  await page.keyboard.press('Escape');

  const inv = await page.evaluate((id) => App.Api.getInvoice(id), savedId);
  await page.evaluate((i) => App.Invoice.printInvoice(i), inv);
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.addStyleTag({ content: '#print-area{padding:57px 57px 0}' });
  await shot('05-phieu-in-a4.png');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    document.body.classList.remove('printing-invoice');
    document.querySelectorAll('style').forEach((s) => s.textContent.includes('#print-area{padding') && s.remove());
  });
  await page.setViewportSize({ width: 1400, height: 860 });

  // --- Cài đặt cửa hàng
  await page.click('#btnSettings');
  await page.waitForSelector('#settingsForm');
  await shot('06-cai-dat-cua-hang.png', { clip: pad(await box(page, '.modal'), 10) });
  await page.keyboard.press('Escape');

  // --- Thư viện hàng hóa
  await page.click('.tab[data-tab="products"]');
  await page.waitForSelector('#productTableBody tr');
  await page.fill('#pfName', 'Keo silicon Apollo A300');
  await page.fill('#pfUnit', 'tuýp');
  await page.fill('#pfCost', '45.000');
  await page.fill('#pfSell', '60.000');
  await page.dispatchEvent('#pfSell', 'input');
  await page.click('#productFormTitle');
  await annotate(page, [
    { sel: '#productForm .product-grid', n: 1 },
    { sel: '#profitPreview', n: 2 },
    { sel: '#pfSubmit', n: 3, pos: 'l' },
    { sel: '#productSearch', n: 4, pos: 'l' },
    { sel: '#productTable thead', n: 5 },
    { sel: '#productTableBody tr:first-child .c-actions', n: 6, pos: 'b' },
  ]);
  await shot('07-thu-vien.png', { clip: { x: 0, y: 0, width: 1400, height: 610 } });

  // --- Lịch sử hóa đơn
  await page.click('.tab[data-tab="history"]');
  await page.waitForSelector('#historyTableBody tr');
  await page.waitForTimeout(300);
  await annotate(page, [
    { sel: '#historySearch', n: 1 },
    { sel: '#historyDate', n: 2 },
    { sel: '#historyToday', n: 3, pos: 'b' },
    { sel: '#historyReset', n: 4, pos: 'b' },
    { sel: '#historyTableBody tr:first-child .c-actions', n: 5, pos: 'l' },
    { sel: '#historySummary', n: 6, pos: 'l' },
  ]);
  await shot('08-lich-su.png', { clip: { x: 0, y: 0, width: 1400, height: await page.$eval('#historySummary', (e) => Math.ceil(e.getBoundingClientRect().bottom) + 24) } });

  await page.click('#historyTableBody tr[data-id="HD_ChiLan_20261115_1530"] [data-action="view"]');
  await page.waitForSelector('.modal .paper-preview');
  await shot('09-xem-hoa-don.png');
  await page.keyboard.press('Escape');

  await page.click('#historyTableBody tr[data-id="HD_ChiLan_20261115_1530"] [data-action="reload"]');
  await page.waitForFunction(() => App.state.activeTab === 'invoice');
  await page.click(cell(0, 'quantity'));
  await page.keyboard.press('Control+A');
  await page.keyboard.type('25');
  await page.click('.summary-label');
  await annotate(page, [
    { sel: '#editBanner', n: 1 },
    { sel: '#saveStatus', n: 2, pos: 'l' },
    { sel: '#btnSave', n: 3, pos: 'l' },
    { sel: '#btnSaveAsNew', n: 4, pos: 'l' },
  ]);
  await shot('10-sua-hoa-don.png');
  await page.evaluate(() => App.Invoice.newInvoice());

  // --- Thống kê
  await page.click('.tab[data-tab="dashboard"]');
  await page.waitForSelector('#revenueChart svg');
  await page.waitForTimeout(300);
  await page.hover('#revenueChart .hit[data-i="6"]');
  await annotate(page, [
    { sel: '.stat-grid', n: 1 },
    { sel: '#revenueChart', n: 2 },
    { sel: '#chartToggle', n: 3, pos: 'l' },
    { sel: '#topProducts', n: 4 },
  ]);
  await shot('11-thong-ke.png', { clip: { x: 0, y: 0, width: 1400, height: await page.$eval('.dash-grid', (e) => Math.ceil(e.getBoundingClientRect().bottom) + 16) } });

  // --- Điện thoại / máy khác trong mạng LAN
  const mobile = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, locale: 'vi-VN' });
  const mp = await mobile.newPage();
  await mp.goto(BASE);
  await mp.waitForFunction(() => window.App && App.state.products.length > 0);
  await mp.fill('#customerName', 'Chị Hoa');
  await mp.click(cell(0, 'product_name'));
  await mp.keyboard.type('bong den');
  await mp.waitForSelector('#acDropdown:not([hidden]) .ac-item');
  await mp.keyboard.press('Enter');
  await mp.keyboard.type('4');
  await mp.click('.summary-label');
  await mp.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await mp.screenshot({ path: path.join(IMG, '13-dien-thoai.png') });
  await mobile.close();

  // --- Ngoại tuyến: tắt máy chủ
  await page.click('.tab[data-tab="invoice"]');
  server.kill();
  await waitFor(async () => { try { await fetch(BASE + '/api/health'); return false; } catch { return true; } });
  await page.evaluate(() => App.Api.ping());
  await page.waitForSelector('#offlineBanner:not([hidden])');
  await annotate(page, [
    { sel: '#offlineBanner', n: 1 },
    { sel: '#connStatus', n: 2, pos: 'l' },
  ]);
  await shot('12-ngoai-tuyen.png', { clip: { x: 0, y: 0, width: 1400, height: 330 } });

  await ctx.close();
  fs.rmSync(DATA, { recursive: true, force: true });
}

async function buildPdf() {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(GUIDE_DIR, 'huong-dan.html')).href);
  await page.waitForLoadState('load');
  await page.pdf({
    path: PDF,
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial,sans-serif">' +
      '<span>Hướng dẫn sử dụng · Phần mềm Quản lý bán hàng vật tư</span><span>Trang <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>',
  });
  await page.close();
}

// ---------------------------------------------------------------------------

async function waitFor(fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Hết thời gian chờ');
}

async function box(page, sel) {
  return page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
}

function pad(b, p) {
  return { x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), width: b.width + 2 * p, height: b.height + 2 * p };
}

/** Vẽ khung đỏ + số thứ tự lên các vùng cần chú thích. */
async function annotate(page, marks) {
  await page.evaluate((marks) => {
    const layer = document.createElement('div');
    layer.id = '__ann';
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:99999;pointer-events:none';
    document.body.appendChild(layer);
    for (const m of marks) {
      const el = document.querySelector(m.sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const p = m.pad ?? 5;
      const x = r.left + scrollX - p;
      const y = r.top + scrollY - p;
      const w = r.width + 2 * p;
      const h = r.height + 2 * p;
      const frame = document.createElement('div');
      frame.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:2.5px solid #e11d48;border-radius:8px;box-sizing:border-box`;
      const badge = document.createElement('div');
      badge.textContent = m.n;
      let bx = x - 12, by = y - 12;
      if (m.pos === 'l') { bx = x - 30; by = y + h / 2 - 13; }
      if (m.pos === 'r') { bx = x + w + 4; by = y + h / 2 - 13; }
      if (m.pos === 'b') { bx = x + w / 2 - 13; by = y + h + 4; }
      badge.style.cssText = `position:absolute;left:${Math.max(2, bx)}px;top:${Math.max(2, by)}px;width:26px;height:26px;border-radius:50%;background:#e11d48;color:#fff;font:700 14px/26px "Segoe UI",Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff`;
      layer.append(frame, badge);
    }
  }, marks);
}
