from tkinter import filedialog, messagebox, ttk
from services.calculations import money
from .widgets import bar, button, field, search, table


class Catalog(ttk.Frame):
    def __init__(self, parent, sales):
        super().__init__(parent, padding=14)
        self.sales = sales
        form = bar(self)
        self.fields = [field(form, i, title, width)[0] for i, (title, width) in enumerate(
            (("Tên hàng", 30), ("Đơn vị tính", 10), ("Giá gốc (đồng)", 14), ("Giá bán (đồng)", 14)))]
        actions = bar(self)
        button(actions, "Thêm", lambda: self.put(False), True)
        self.edit = button(actions, "Cập nhật", lambda: self.put(True))
        self.delete = button(actions, "Xóa", self.remove)
        button(actions, "Nhập từ Excel", self.import_file)
        self.query = search(self, "Tìm tên hàng", self.refresh)
        self.tree = table(self, (("name", "Tên hàng", 240, "w"), ("unit", "Đơn vị", 90, "w"),
                          ("cost", "Giá gốc", 110, "e"), ("price", "Giá bán", 110, "e"),
                          ("profit", "Lợi nhuận", 110, "e")))
        self.tree.bind("<<TreeviewSelect>>", self.select)
        self.refresh()

    def select(self, event=None):
        selected = self.tree.selection()
        for btn in (self.edit, self.delete):
            btn.state(["!disabled"] if selected else ["disabled"])
        if selected:
            key = selected[0]
            p = self.sales.products[key]
            for var, value in zip(self.fields, (key, p["unit"], money(p["cost_price"]), money(p["selling_price"]))):
                var.set(value)

    def put(self, editing):
        original = self.tree.selection()[0] if editing else None
        self.sales.put_product(*(v.get() for v in self.fields), original=original)
        self.refresh()

    def remove(self):
        name = self.tree.selection()[0]
        if messagebox.askyesno("Xóa hàng hóa", f"Xóa {name} khỏi thư viện?", parent=self):
            self.sales.delete_product(name)
            for v in self.fields:
                v.set("")
            self.refresh()

    def import_file(self):
        path = filedialog.askopenfilename(parent=self, title="Nhập danh mục hàng hóa",
                                          filetypes=[("Bảng tính Excel", "*.xlsx")])
        if path:
            added, updated, skipped = self.sales.import_products(path)
            self.refresh()
            messagebox.showinfo("Kết quả nhập", f"Thêm mới: {added}\nCập nhật: {updated}\nBỏ qua: {skipped}", parent=self)

    def refresh(self):
        self.tree.delete(*self.tree.get_children())
        for index, key in enumerate(self.sales.search_products(self.query.get())):
            p = self.sales.products[key]
            cost, price = p["cost_price"], p["selling_price"]
            self.tree.insert("", "end", iid=key, values=(key, p["unit"], money(cost), money(price),
                             money(price-cost)), tags=("stripe",) if index % 2 else ())
        self.select()

