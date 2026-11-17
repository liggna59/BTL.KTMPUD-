from tkinter import messagebox, ttk
from services.calculations import money
from .widgets import LINE_COLUMNS, bar, button, search, show_lines, table


class History(ttk.Frame):
    def __init__(self, parent, sales, load):
        super().__init__(parent, padding=14)
        self.sales = sales
        self.load_invoice = load
        self.query = search(self, "Tìm mã hóa đơn, khách hàng hoặc ngày chốt", self.refresh)
        self.tree = table(self, (("code", "Mã hóa đơn", 225, "w"), ("date", "Thời điểm lập", 150, "w"),
                          ("closing", "Ngày chốt", 105, "w"), ("customer", "Khách hàng", 150, "w"),
                          ("total", "Tổng cộng", 110, "e")), height=5)
        self.tree.bind("<<TreeviewSelect>>", self.select)
        actions = bar(self)
        self.load = button(actions, "Tải lên hóa đơn", self.open, True)
        self.delete = button(actions, "Xóa", self.remove)
        ttk.Label(self, text="Chi tiết hóa đơn", style="Total.TLabel").pack(anchor="w", pady=(6, 0))
        self.detail = table(self, LINE_COLUMNS, height=4)
        self.refresh()

    def select(self, event=None):
        selected = self.tree.selection()
        for btn in (self.load, self.delete):
            btn.state(["!disabled"] if selected else ["disabled"])
        show_lines(self.detail, self.sales.history[selected[0]]["items"] if selected else [])

    def open(self):
        key = self.tree.selection()[0]
        if self.sales.lines and not messagebox.askyesno("Tải hóa đơn", "Thay nội dung đang lập bằng hóa đơn đã chọn?", parent=self):
            return
        self.load_invoice(key)

    def remove(self):
        code = self.tree.selection()[0]
        if messagebox.askyesno("Xóa hóa đơn", f"Xóa hóa đơn {code} và các tệp đã xuất?", parent=self):
            self.sales.delete_invoice(code)
            self.refresh()

    def refresh(self):
        self.tree.delete(*self.tree.get_children())
        for idx, key in enumerate(self.sales.search_history(self.query.get())):
            r = self.sales.history[key]
            self.tree.insert("", "end", iid=key, values=(key, r["date"], r["input_date"], r["customer"],
                             money(r["total"])), tags=("stripe",) if idx % 2 else ())
        self.select()

