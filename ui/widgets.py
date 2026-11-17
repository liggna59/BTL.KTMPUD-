import tkinter as tk
from tkinter import ttk

from services.calculations import money


def field(parent, column, title, width=15, combo=False, weight=1):
    parent.columnconfigure(column, weight=weight)
    ttk.Label(parent, text=title).grid(row=0, column=column, sticky="w", padx=(0, 10))
    value = tk.StringVar(parent)
    widget = (ttk.Combobox if combo else ttk.Entry)(parent, textvariable=value, width=width)
    widget.grid(row=1, column=column, sticky="ew", padx=(0, 10), pady=(4, 3))
    return value, widget


def bar(parent):
    frame = ttk.Frame(parent)
    frame.pack(fill="x", pady=6)
    return frame


def button(parent, text, action, primary=False):
    widget = ttk.Button(parent, text=text, command=action,
                        style="Primary.TButton" if primary else "TButton")
    widget.pack(side="left", padx=(0, 6))
    return widget


def table(parent, columns, height=8):
    frame = ttk.Frame(parent)
    frame.pack(expand=True, fill="both", pady=(4, 6))
    keys = [key for key, *_ in columns]
    tree = ttk.Treeview(frame, columns=keys, show="headings", selectmode="browse", height=height)
    for key, label, width, anchor in columns:
        tree.heading(key, text=label, anchor=anchor)
        tree.column(key, width=width, minwidth=40, anchor=anchor)
    scroll = ttk.Scrollbar(frame, command=tree.yview)
    horizontal = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
    tree.configure(yscrollcommand=scroll.set, xscrollcommand=horizontal.set)
    frame.rowconfigure(0, weight=1)
    frame.columnconfigure(0, weight=1)
    tree.grid(row=0, column=0, sticky="nsew")
    scroll.grid(row=0, column=1, sticky="ns")
    horizontal.grid(row=1, column=0, sticky="ew")
    tree.tag_configure("stripe", background="#eff5f2")
    return tree


LINE_COLUMNS = (("name", "Tên hàng", 210, "w"), ("unit", "ĐVT", 60, "w"),
                ("quantity", "Số lượng", 80, "e"), ("unit_price", "Đơn giá", 105, "e"),
                ("amount", "Thành tiền", 125, "e"), ("export_date", "Ngày xuất", 112, "center"))


def show_lines(tree, lines):
    tree.delete(*tree.get_children())
    for index, item in enumerate(lines):
        values = [item[k] for k, *_ in LINE_COLUMNS]
        quantity = values[2]
        values[2] = "" if quantity is None else format(quantity, ".6f").rstrip("0").rstrip(".")
        values[3:5] = map(money, values[3:5])
        tree.insert("", "end", iid=str(index), values=values, tags=("stripe",) if index % 2 else ())


def search(parent, title, callback):
    row = bar(parent)
    ttk.Label(row, text=title).pack(side="left", padx=(0, 12))
    value = tk.StringVar(parent)
    ttk.Entry(row, textvariable=value).pack(side="left", fill="x", expand=True)
    pending = None

    def run_search():
        nonlocal pending
        pending = None
        callback()

    def schedule_search(*_):
        nonlocal pending
        if pending is not None:
            parent.after_cancel(pending)
        # Đợi người dùng ngừng gõ một nhịp trước khi dựng lại bảng.
        pending = parent.after(150, run_search)

    value.trace_add("write", schedule_search)
    return value

