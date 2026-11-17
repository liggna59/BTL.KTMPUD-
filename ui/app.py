import tkinter as tk
from tkinter import messagebox, ttk
from tkinter import font
from .catalog import Catalog
from .history import History
from .invoice import Invoice


class Application:
    def __init__(self, root, sales):
        self.root = root
        root.title("Quản lý bán hàng và hóa đơn")
        root.geometry(f"{min(root.winfo_screenwidth()-24, 1120)}x{min(root.winfo_screenheight()-85, 720)}")
        root.minsize(760, 535)
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont"):
            font.nametofont(name).configure(family="Segoe UI", size=11)
        style = ttk.Style(root)
        style.theme_use("clam")
        style.configure(".", font=("Segoe UI", 11), background="#f8faf9", foreground="#183c32")
        style.configure("TButton", padding=(9, 5))
        style.configure("Primary.TButton", background="#175747", foreground="white")
        style.map("Primary.TButton", background=[("active", "#216e57")], foreground=[("disabled", "#c4d1cc")])
        style.configure("TNotebook.Tab", padding=(16, 7))
        style.map("TNotebook.Tab", background=[("selected", "#dfede6")])
        style.configure("Treeview", rowheight=30, fieldbackground="white", background="white")
        style.map("Treeview", background=[("selected", "#235e50")], foreground=[("selected", "white")])
        style.configure("Treeview.Heading", font=("Segoe UI", 10, "bold"), padding=5)
        style.configure("Total.TLabel", font=("Segoe UI", 15, "bold"))
        tk.Label(root, text="Quản lý bán hàng", anchor="w", padx=18, pady=9, bg="#174b3f",
                 fg="white", font=("Segoe UI", 17, "bold")).pack(fill="x")
        self.tabs = ttk.Notebook(root)
        self.tabs.pack(fill="both", expand=True)
        self.invoice = Invoice(self.tabs, sales)
        self.catalog = Catalog(self.tabs, sales)
        self.history = History(self.tabs, sales, self.load)
        for frame, title in ((self.invoice, "Hóa đơn"), (self.catalog, "Thư viện hàng hóa"),
                             (self.history, "Lịch sử đơn hàng")):
            self.tabs.add(frame, text=title)
        self.tabs.bind("<<NotebookTabChanged>>", self.changed)
        root.bind_all("<Control-z>", self.undo)
        root.bind_all("<Control-s>", self.save)
        root.bind_all("<F2>", self.new_line)
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.report_callback_exception = self.error

    def changed(self, event=None):
        current = self.tabs.select()
        if current == str(self.catalog):
            self.catalog.refresh()
        elif current == str(self.history):
            self.history.refresh()
        else:
            self.invoice.refresh_library()

    def load(self, key):
        self.invoice.load(key)
        self.tabs.select(self.invoice)

    def undo(self, event=None):
        if self.tabs.select() == str(self.invoice):
            self.invoice.undo()
            return "break"

    def save(self, event=None):
        if self.tabs.select() == str(self.invoice):
            self.invoice.save()
            return "break"

    def new_line(self, event=None):
        self.tabs.select(self.invoice)
        self.invoice.new_line()
        return "break"

    def close(self):
        if self.invoice.has_unsaved_changes() and not messagebox.askyesno(
                "Đóng ứng dụng", "Có nội dung đang nhập hoặc thay đổi chưa lưu. Bạn muốn đóng ứng dụng?",
                parent=self.root):
            return
        self.root.destroy()

    def error(self, kind, value, traceback):
        messagebox.showerror("Không thể hoàn tất thao tác", str(value), parent=self.root)

