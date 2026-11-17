from tkinter import messagebox, ttk

from services.calculations import invoice_total, line_amount, money, number, today, vietnamese_words
from .widgets import LINE_COLUMNS, bar, button, field, show_lines, table


class Invoice(ttk.Frame):
    def __init__(self, parent, sales):
        super().__init__(parent, padding=14)
        self.sales = sales
        self.drag = None
        top = bar(self)
        self.customer, _ = field(top, 0, "Khách hàng", width=38, weight=4)
        self.closing, _ = field(top, 1, "Ngày chốt đơn")
        self.closing.set(today())
        entry = bar(self)
        self.name, self.combo = field(entry, 0, "Tên hàng", 24, combo=True, weight=4)
        self.unit, _ = field(entry, 1, "Đơn vị tính", 8)
        self.qty, self.quantity_entry = field(entry, 2, "SL (trống nếu khoán)", 13)
        self.price, _ = field(entry, 3, "Đơn giá (đồng)", 12)
        self.date, _ = field(entry, 4, "Ngày xuất", 12)
        self.date.set(today())
        self.name.trace_add("write", lambda *_: self.refresh_library())
        self.combo.bind("<<ComboboxSelected>>", self.autofill)
        for widget in entry.grid_slaves(row=1):
            widget.bind("<Return>", self.enter)
        self.preview = ttk.Label(self, text="Thành tiền dòng đang nhập")
        self.preview.pack(anchor="w")
        self.qty.trace_add("write", self.update_preview)
        self.price.trace_add("write", self.update_preview)
        actions = bar(self)
        button(actions, "Thêm dòng", lambda: self.submit(False), True)
        self.edit = button(actions, "Cập nhật dòng", lambda: self.submit(True))
        self.delete = button(actions, "Xóa dòng", self.remove)
        self.back = button(actions, "Hoàn tác", self.undo)
        button(actions, "Làm mới", self.reset)
        self.tree = table(self, LINE_COLUMNS)
        self.tree.bind("<<TreeviewSelect>>", self.select)
        self.tree.bind("<ButtonPress-1>", self.press)
        self.tree.bind("<ButtonRelease-1>", self.release)
        self.summary = ttk.Label(self, style="Total.TLabel")
        self.summary.pack(anchor="e")
        self.words = ttk.Label(self, wraplength=780)
        self.words.pack(anchor="e")
        actions = bar(self)
        button(actions, "Lưu hóa đơn", self.save, True)
        button(actions, "Xuất Word", lambda: self.export("docx"))
        button(actions, "Xuất Excel", lambda: self.export("xlsx"))
        self.refresh()
        self.saved_state = self.current_state()

    def refresh_library(self):
        self.combo.configure(values=self.sales.search_products(self.name.get()))

    def update_preview(self, *_):
        try:
            quantity = None if not self.qty.get().strip() else number(self.qty.get(), "Số lượng")
            price = number(self.price.get(), "Đơn giá", True)
            amount = line_amount(quantity, price)
            self.preview.configure(text=f"Thành tiền dòng đang nhập: {money(amount)} đồng")
        except ValueError:
            self.preview.configure(text="Thành tiền dòng đang nhập: —")

    def current_state(self):
        return (self.customer.get(), self.closing.get(), self.sales.lines.copy())

    def has_unsaved_changes(self):
        entered = any(value.get().strip() for value in (self.name, self.unit, self.qty, self.price))
        return entered or self.current_state() != self.saved_state

    def new_line(self):
        self.tree.selection_remove(*self.tree.selection())
        self.clear_fields()
        self.combo.focus_set()

    def autofill(self, event):
        p = self.sales.products.get(self.name.get())
        if p:
            self.unit.set(p["unit"])
            self.price.set(money(p["selling_price"]))
            self.quantity_entry.focus_set()

    def index(self):
        selected = self.tree.selection()
        return int(selected[0]) if selected else None

    def enter(self, event):
        self.submit(self.index() is not None)
        return "break"

    def submit(self, editing):
        index = self.index() if editing else None
        if editing and index is None:
            return
        self.sales.put_line(self.name.get(), self.unit.get(), self.qty.get(), self.price.get(),
                            self.date.get(), index)
        self.clear_fields()
        self.refresh()
        self.combo.focus_set()

    def clear_fields(self):
        for value in (self.name, self.unit, self.qty, self.price):
            value.set("")

    def select(self, event=None):
        index = self.index()
        enabled = ["disabled"] if index is None else ["!disabled"]
        self.edit.state(enabled)
        self.delete.state(enabled)
        if index is not None:
            i = self.sales.lines[index]
            self.name.set(i["name"])
            self.unit.set(i["unit"])
            quantity = i["quantity"]
            self.qty.set("" if quantity is None else format(quantity, ".6f").rstrip("0").rstrip("."))
            self.price.set(money(i["unit_price"]))
            self.date.set(i["export_date"])

    def press(self, event):
        self.drag = self.tree.identify_row(event.y)

    def release(self, event):
        target = self.tree.identify_row(event.y)
        if self.drag and target and self.drag != target:
            self.sales.move(int(self.drag), int(target))
            self.refresh()
            self.tree.selection_set(target)
        self.drag = None

    def refresh(self):
        self.refresh_library()
        show_lines(self.tree, self.sales.lines)
        total = invoice_total(self.sales.lines)
        self.summary.configure(text=f"Tổng cộng   {money(total)} đồng")
        self.words.configure(text=vietnamese_words(total))
        self.back.state(["!disabled"] if self.sales.undo_states else ["disabled"])
        self.select()

    def remove(self):
        if self.index() is not None:
            self.sales.remove_line(self.index())
            self.clear_fields()
            self.refresh()

    def undo(self):
        if self.sales.undo():
            self.clear_fields()
            self.refresh()

    def reset(self):
        if self.has_unsaved_changes() and not messagebox.askyesno(
                "Làm mới", "Bỏ thay đổi chưa lưu và bắt đầu hóa đơn mới?", parent=self):
            return
        self.sales.fresh()
        self.clear_fields()
        self.customer.set("")
        self.date.set(today())
        self.closing.set(today())
        self.refresh()
        self.saved_state = self.current_state()

    def load(self, code):
        customer, closing = self.sales.load(code)
        self.customer.set(customer)
        self.closing.set(closing)
        self.clear_fields()
        self.date.set(today())
        self.refresh()
        self.saved_state = self.current_state()

    def save(self):
        code = self.sales.save(self.customer.get(), self.closing.get())
        self.saved_state = self.current_state()
        messagebox.showinfo("Đã lưu hóa đơn", code, parent=self)

    def export(self, kind):
        path = self.sales.export(kind, self.customer.get(), self.closing.get())
        messagebox.showinfo("Đã xuất hóa đơn", str(path), parent=self)

