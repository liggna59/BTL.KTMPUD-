// Kiểm thử các thuật toán lõi phía client. Chạy: node --test tests/js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const U = require(path.join(__dirname, '..', '..', 'web', 'js', 'utils.js'));
const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'testdata', 'number_words.json'), 'utf8')
);

test('numberToVietnameseWords khớp bộ dữ liệu dùng chung với server Go', () => {
  for (const { amount, words } of vectors) {
    assert.equal(U.numberToVietnameseWords(amount), words, `amount = ${amount}`);
  }
});

test('numberToVietnameseWords với dữ liệu rỗng / không hợp lệ', () => {
  assert.equal(U.numberToVietnameseWords(''), '');
  assert.equal(U.numberToVietnameseWords(null), '');
  assert.equal(U.numberToVietnameseWords('abc'), '');
});

test('calculateLineItem: TC03 tính thành tiền chuẩn', () => {
  assert.deepEqual(U.calculateLineItem(5, 20000), { totalPrice: 100000, isLumpSum: false });
  assert.deepEqual(U.calculateLineItem('1.5', 20000), { totalPrice: 30000, isLumpSum: false });
  assert.deepEqual(U.calculateLineItem('2,5', 1000), { totalPrice: 2500, isLumpSum: false });
});

test('calculateLineItem: TC04 bán khoán khi để trống số lượng', () => {
  for (const q of ['', '   ', null, undefined]) {
    assert.deepEqual(U.calculateLineItem(q, 350000), { totalPrice: 350000, isLumpSum: true });
  }
});

test('calculateLineItem: số lượng <= 0 hoặc không hợp lệ', () => {
  assert.deepEqual(U.calculateLineItem(0, 5000), { totalPrice: 0, isLumpSum: false });
  assert.deepEqual(U.calculateLineItem(-3, 5000), { totalPrice: 0, isLumpSum: false });
  assert.deepEqual(U.calculateLineItem('x', 5000), { totalPrice: 0, isLumpSum: false });
});

test('UndoManager giữ tối đa 50 bước, deep copy, LIFO', () => {
  const um = new U.UndoManager();
  const state = { items: [{ name: 'a' }] };
  um.pushState(state);
  state.items[0].name = 'b';
  assert.equal(um.undo().items[0].name, 'a');
  assert.equal(um.canUndo(), false);
  for (let i = 0; i < 60; i++) um.pushState({ i });
  assert.equal(um.size, 50);
  assert.equal(um.undo().i, 59);
  assert.equal(um.history[0].i, 10);
  assert.equal(new U.UndoManager().undo(), null);
});

test('parseMoney hiểu các cách gõ của thu ngân', () => {
  assert.equal(U.parseMoney('20.000'), 20000);
  assert.equal(U.parseMoney('20,000'), 20000);
  assert.equal(U.parseMoney(' 350000 '), 350000);
  assert.equal(U.parseMoney('20k'), 20000);
  assert.equal(U.parseMoney('1,5tr'), 1500000);
  assert.equal(U.parseMoney('2m'), 2000000);
  assert.equal(U.parseMoney('95.000đ'), 95000);
  assert.equal(U.parseMoney(''), null);
  assert.ok(Number.isNaN(U.parseMoney('abc')));
  assert.ok(Number.isNaN(U.parseMoney('-5')));
});

test('định dạng tiền, số lượng, ngày', () => {
  assert.equal(U.formatMoney(1850000), '1.850.000');
  assert.equal(U.formatCurrency(158450000), '158.450.000 đ');
  assert.equal(U.formatQuantity(1.5), '1,5');
  assert.equal(U.formatDate('2026-11-16'), '16/11/2026');
  assert.equal(U.formatDateLong('2026-11-16'), 'Ngày 16 tháng 11 năm 2026');
  assert.match(U.nowISO(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('tìm kiếm không dấu: TC02 gõ "Ống" hoặc "ong" đều ra các loại ống', () => {
  const names = ['Ống nhựa Tiền Phong D21', 'Xi măng Hoàng Thạch', 'Bóng đèn LED', 'Ống luồn dây điện D16'];
  const hit = (q) => names.filter((n) => U.matchScore(n, q) >= 0);
  assert.deepEqual(hit('Ống'), ['Ống nhựa Tiền Phong D21', 'Bóng đèn LED', 'Ống luồn dây điện D16']);
  assert.ok(U.matchScore('Ống nhựa Tiền Phong D21', 'ống') < U.matchScore('Bóng đèn LED', 'ống'));
  assert.deepEqual(hit('ong 21'), ['Ống nhựa Tiền Phong D21']);
  assert.equal(U.normalizeText('  Đá   1x2 '), 'da 1x2');
});

test('highlightMatch tô đúng vị trí trên chuỗi có dấu và escape HTML', () => {
  assert.equal(U.highlightMatch('Ống nhựa', 'ong'), '<mark>Ống</mark> nhựa');
  assert.equal(U.highlightMatch('<b>Đá</b>', 'da'), '&lt;b&gt;<mark>Đá</mark>&lt;/b&gt;');
});
