from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from docx import Document
from openpyxl import Workbook, load_workbook

from data.storage import Storage
from services.sales import Sales


class SalesTests(unittest.TestCase):
    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = Storage(folder.name)
        self.sales = Sales(self.store)
        self.day = "17/11/2026"

    def add(self, name="Ống nước", qty="1,5", price="10.500"):
        self.sales.put_line(name, "mét", qty, price, self.day)

    def test_undo_limit(self):
        for i in range(55):
            self.add(price=str(i))
        self.assertEqual(len(self.sales.undo_states), 50)
        for _ in range(50):
            self.assertTrue(self.sales.undo())
        self.assertEqual(len(self.sales.lines), 5)
        self.assertFalse(self.sales.undo())

    def test_roundtrip(self):
        s = self.sales
        s.put_product("Ống nước", "cây", 8200, 9900)
        self.add()
        self.add("=Lắp đặt", "", "30.000")
        self.assertEqual(s.products["Ống nước"]["cost_price"], 8200)
        s.move(1, 0)
        code = s.save("Chị Hằng", self.day)
        new = Sales(self.store)
        self.assertEqual(new.load(code), ("Chị Hằng", self.day))
        self.assertEqual(new.lines, s.lines)
        self.assertEqual(new.search_history("chi hang"), [code])
        self.assertEqual(new.search_history("không có"), [])
        word = new.export("docx", "Chị Hằng", self.day)
        excel = new.export("xlsx", "Chị Hằng", self.day)
        doc = Document(word)
        self.assertIn("45.750", " ".join(p.text for p in doc.paragraphs))
        book = load_workbook(excel)
        self.assertEqual(book.active["F8"].value, 45750)
        self.assertEqual(book.active["B6"].data_type, "s")
        self.assertEqual(book.active["D6"].value, None)
        book.close()
        new.remove_line(0)
        self.assertEqual(new.save("Chị Hằng", self.day), code)
        self.assertEqual(new.history[code]["total"], 15750)
        new.delete_invoice(code)
        self.assertFalse(excel.exists() or word.exists())
        self.assertEqual(Sales(self.store).history, {})

    def test_import_transaction(self):
        sample = Path(__file__).resolve().parents[1] / "sample_products.xlsx"
        self.assertEqual(self.sales.import_products(sample), (10, 0, 0))
        self.assertEqual(self.sales.import_products(sample), (0, 10, 0))
        path = self.store.folder / "mau.xlsx"
        b = Workbook()
        b.active.append([" GIA BAN ", "ten hang", "don vi tinh", "Gia goc"])
        b.active.append([200, "Đinh", "cái", 150])
        b.active.append(["không rõ", "Sơn", "lon", 50])
        b.save(path)
        self.assertEqual(self.sales.import_products(path), (1, 0, 1))
        before = self.store.read("products")
        b.active["A1"] = "Sai tên cột"
        b.save(path)
        with self.assertRaises(ValueError):
            self.sales.import_products(path)
        path.write_bytes(b"broken")
        with self.assertRaises(ValueError):
            self.sales.import_products(path)
        self.assertEqual(self.store.read("products"), before)

    def test_failed_edits_preserve_state(self):
        self.add()
        with self.assertRaises(ValueError):
            self.add(price="")
        with patch.object(self.store, "write", side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                self.add(name="Khác")
        self.assertEqual(len(self.sales.lines), 1)

        self.assertNotIn("Khác", self.sales.products)
        path = self.sales.export("xlsx", "", self.day)
        old = path.read_bytes()
        with patch("data.storage.os.replace", side_effect=PermissionError("Tệp đang mở")):
            with self.assertRaisesRegex(ValueError, "Không thể ghi"):
                self.sales.export("xlsx", "", self.day)
        self.assertEqual(path.read_bytes(), old)
        self.assertEqual(len(self.sales.lines), 1)


    def test_small_quantity_roundtrip(self):
        self.add(qty="0,000001", price="1000000")
        code = self.sales.save("Khách thử", self.day)
        reopened = Sales(self.store)
        reopened.load(code)
        self.assertEqual(reopened.lines[0]["quantity"], 0.000001)
        self.assertEqual(reopened.lines[0]["amount"], 1)

    def test_unchanged_product_does_not_write(self):
        self.add()
        with patch.object(self.store, "write", wraps=self.store.write) as write:
            self.add(qty="2")
            write.assert_not_called()
        self.assertEqual(len(self.sales.lines), 2)

    def test_search_after_catalog_changes(self):
        self.add()
        self.assertEqual(self.sales.search_products("ong nuoc"), ["Ống nước"])
        self.sales.put_product("Sơn trắng", "lon", 10, 20, original="Ống nước")
        self.assertEqual(self.sales.search_products("ong nuoc"), [])
        self.assertEqual(self.sales.search_products("son"), ["Sơn trắng"])
        self.sales.delete_product("Sơn trắng")
        self.assertEqual(self.sales.search_products("son"), [])
