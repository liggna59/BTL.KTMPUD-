from pathlib import Path
import sys
import tkinter as tk
from tkinter import messagebox
from data.storage import Storage
from services.sales import Sales
from ui.app import Application


def main():
    root = tk.Tk()
    root.withdraw()
    try:
        # Bản đóng gói dùng thư mục cạnh exe, thay vì thư mục giải nén tạm.
        program = Path(sys.executable) if getattr(sys, "frozen", False) else Path(__file__)
        sales = Sales(Storage(program.resolve().parent))
    except (OSError, ValueError) as exc:
        messagebox.showerror("Không thể mở dữ liệu cửa hàng", str(exc), parent=root)
        root.destroy()
        return
    Application(root, sales)
    root.deiconify()
    root.mainloop()


if __name__ == "__main__":
    main()

