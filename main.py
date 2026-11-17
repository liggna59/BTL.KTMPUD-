from pathlib import Path
import tkinter as tk
from tkinter import messagebox
from data.storage import Storage
from services.sales import Sales
from ui.app import Application


def main():
    root = tk.Tk()
    root.withdraw()
    try:
        sales = Sales(Storage(Path(__file__).resolve().parent))
    except (OSError, ValueError) as exc:
        messagebox.showerror("Không thể mở dữ liệu cửa hàng", str(exc), parent=root)
        root.destroy()
        return
    Application(root, sales)
    root.deiconify()
    root.mainloop()


if __name__ == "__main__":
    main()

