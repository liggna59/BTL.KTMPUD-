import unittest
from datetime import datetime

from services.calculations import (invoice_id, invoice_total, line_amount, number,
                                   sanitize_filename, vietnamese_words)


class Calculations(unittest.TestCase):
    def test_words(self):
        for amount, expected in {
            0: "Không", 4: "Bốn", 10: "Mười", 14: "Mười bốn", 15: "Mười lăm",
            21: "Hai mươi mốt", 24: "Hai mươi tư", 25: "Hai mươi lăm",
            34: "Ba mươi tư", 1005: "Một nghìn không trăm lẻ năm",
            1234567: "Một triệu hai trăm ba mươi bốn nghìn năm trăm sáu mươi bảy",
            1000000001: "Một tỷ không trăm lẻ một",
        }.items():
            with self.subTest(amount=amount):
                self.assertEqual(vietnamese_words(amount), expected + " đồng")

    def test_amounts(self):
        for qty, price, expected in [(None, 10500, 10500), ("", 80, 80), (0, 300, 0),
                                     (2.5, 1001, 2503), (3, 15000, 45000)]:
            self.assertEqual(line_amount(qty, price), expected)
        self.assertEqual(invoice_total([dict(quantity=2.5, unit_price=80),
                                       dict(quantity=None, unit_price=45)]), 245)

    def test_names(self):
        self.assertEqual(sanitize_filename(' A\\/:*?"<>|B .'), "AB")
        self.assertEqual(sanitize_filename("NUL.txt"), "_NUL.txt")
        self.assertEqual(sanitize_filename("..."), "Khách lẻ")

    def test_codes(self):
        when = datetime(2026, 10, 3, 9, 8, 42)
        code = invoice_id("", when)
        self.assertEqual(code, "Khách lẻ_20261003_0908")
        self.assertEqual(invoice_id("", when, [code.upper()]), code + "_2")
        code = invoice_id("Ớ" * 200, when)
        self.assertEqual(code, sanitize_filename(code))

    def test_numbers(self):
        self.assertEqual(number("20k", "Giá", True), 20000)
        self.assertEqual(number("1,5tr", "Giá", True), 1500000)
        self.assertEqual(number("1.5 K", "Giá", True), 1500)
        with self.assertRaises(ValueError):
            number("1,0000001k", "Giá", True)
        self.assertEqual(number("12.500", "Giá", True), 12500)
        self.assertEqual(number("0,125", "SL"), 0.125)
        for bad in ("", "NaN", "abc", "-1", "12..500", "1e20"):
            with self.assertRaises(ValueError):
                number(bad, "Giá", True)

