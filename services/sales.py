from collections import deque
from copy import deepcopy
from datetime import datetime

from data import office
from .calculations import (folded, invoice_id, invoice_total, line_amount, money, number,
                           sanitize_filename, valid_date, vietnamese_words)


def product(name, unit, cost, selling):
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Vui lòng nhập tên hàng.")
    if not isinstance(unit, str) or not unit.strip():
        raise ValueError("Vui lòng nhập đơn vị tính.")
    return name.strip(), dict(unit=unit.strip(), cost_price=number(cost, "Giá gốc", True),
                              selling_price=number(selling, "Giá bán", True))


def make_line(name, unit, quantity, price, date):
    name, info = product(name, unit, 0, price)
    qty = None if quantity is None or str(quantity).strip() == "" else number(quantity, "Số lượng")
    price = info["selling_price"]
    return dict(name=name, unit=info["unit"], quantity=qty, unit_price=price,
                amount=line_amount(qty, price), export_date=valid_date(date))


class Sales:
    def __init__(self, storage):
        self.storage = storage
        self.lines = []
        self.code = self.created = None
        self.undo_states = deque(maxlen=50)
        self.storage.initialize()
        self.products = self.storage.read("products")
        self.history = self.storage.read("history")
        try:
            for key, p in self.products.items():
                _, self.products[key] = product(key, p["unit"], p["cost_price"], p["selling_price"])
            for key, r in self.history.items():
                if not all(isinstance(r[field], str) for field in ("date", "input_date", "customer")):
                    raise ValueError("Thông tin hóa đơn không hợp lệ.")
                r["items"] = [make_line(i["name"], i["unit"], i["quantity"], i["unit_price"],
                                        i["export_date"]) for i in r["items"]]
                r["total"] = invoice_total(r["items"])
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            raise ValueError(f"Dữ liệu đã lưu không hợp lệ ({key}). {exc}") from exc

    def commit(self, collection, updated):
        self.storage.write(collection, updated)
        setattr(self, collection, updated)

    def put_product(self, name, unit, cost, selling, original=None):
        key, value = product(name, unit, cost, selling)
        updated = self.products.copy()
        if original and original != key:
            if key in updated:
                raise ValueError("Tên mới trùng với một mặt hàng đã có.")
            del updated[original]
        updated[key] = value
        self.commit("products", updated)

    def delete_product(self, name):
        updated = self.products.copy()
        del updated[name]
        self.commit("products", updated)

    def import_products(self, path):
        rows = office.read_products(path, folded)
        updated = self.products.copy()
        added = changed = skipped = 0
        for row in rows:
            try:
                key, value = product(*row)
            except ValueError:
                skipped += 1
                continue
            if key in updated:
                changed += 1
            else:
                added += 1
            updated[key] = value
        if added or changed:
            self.commit("products", updated)
        return added, changed, skipped

    def search_products(self, query):
        needle = folded(query)
        return [name for name in self.products if needle in folded(name)]

    def search_history(self, query):
        needle = folded(query)
        return [key for key, r in reversed(self.history.items()) if any(
            needle in folded(value) for value in (key, r["customer"], r["input_date"]))]

    def remember(self):
        self.undo_states.append(self.lines.copy())

    def put_line(self, name, unit, quantity, price, date, index=None):
        line = make_line(name, unit, quantity, price, date)
        cost = self.products.get(line["name"], {}).get("cost_price", 0)
        self.put_product(line["name"], line["unit"], cost, line["unit_price"])
        self.remember()
        if index is None:
            self.lines.append(line)
        else:
            self.lines[index] = line

    def remove_line(self, index):
        self.remember()
        self.lines.pop(index)

    def move(self, source, dest):
        if source != dest:
            self.remember()
            self.lines.insert(dest, self.lines.pop(source))

    def undo(self):
        if self.undo_states:
            self.lines = self.undo_states.pop()
            return True
        return False

    def fresh(self):
        self.remember()
        self.lines = []
        self.code = self.created = None

    def load(self, code):
        r = self.history[code]
        self.undo_states.clear()
        self.lines = deepcopy(r["items"])
        self.code, self.created = code, r["date"]
        return r["customer"], r["input_date"]

    def record(self, customer, closing):
        if not self.lines:
            raise ValueError("Vui lòng thêm ít nhất một dòng hàng.")
        when = datetime.now()
        customer = customer.strip() or "Khách lẻ"
        code = self.code or invoice_id(customer, when, self.history.keys() | self.storage.exported_ids())
        return code, dict(date=self.created or when.strftime("%d/%m/%Y %H:%M"),
                          input_date=valid_date(closing), customer=customer,
                          items=deepcopy(self.lines), total=invoice_total(self.lines))

    def save(self, customer, closing):
        code, record = self.record(customer, closing)
        self.commit("history", {**self.history, code: record})
        self.code, self.created = code, record["date"]
        return code

    def export(self, kind, customer, closing):
        code, record = self.record(customer, closing)
        path = self.storage.export_path(sanitize_filename(code), kind)
        words = vietnamese_words(record["total"])
        try:
            if kind == "docx":
                office.write_word(path, code, record, words, money)
            else:
                office.write_excel(path, code, record, words)
        except Exception as exc:
            raise ValueError(f"Không thể ghi {path}. Hãy đóng tệp đang mở và kiểm tra quyền ghi.\n{exc}") from exc
        self.code, self.created = code, record["date"]
        return path

    def delete_invoice(self, code):
        updated = self.history.copy()
        del updated[code]
        self.commit("history", updated)
        if self.code == code:
            self.code = self.created = None
        self.storage.remove_exports(sanitize_filename(code))

