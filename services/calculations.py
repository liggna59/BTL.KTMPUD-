import re
import unicodedata
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache


@lru_cache(maxsize=20000)
def folded(text):
    """Nhớ kết quả bỏ dấu để tìm kiếm nhiều lần trên cùng danh mục."""
    text = unicodedata.normalize("NFD", str(text).casefold().replace("đ", "d"))
    return " ".join("".join(c for c in text if not unicodedata.combining(c)).split())


def number(value, label, whole=False):
    """Prices use whole VND. Quantities accept a decimal comma or point."""
    text = str(value).strip()
    # JSON có thể đọc số lượng nhỏ thành float dạng 1e-06.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        text = format(Decimal(str(value)), "f")
    multiplier = 1
    if whole:
        shortcut = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(k|tr)", text.casefold())
        if shortcut:
            text = shortcut.group(1)
            multiplier = {"k": 1000, "tr": 1000000}[shortcut.group(2)]
    if whole and multiplier == 1 and re.fullmatch(r"\d{1,3}([., ])\d{3}(?:\1\d{3})*", text):
        text = re.sub(r"[., ]", "", text)
    if not re.fullmatch(r"\d+(?:[.,]\d+)?", text):
        raise ValueError(f"{label} phải là số không âm.")
    n = Decimal(text.replace(",", ".")) * multiplier
    if n > 999_999_999_999 or (whole and n != int(n)):
        raise ValueError(f"{label} vượt giới hạn hoặc có phần lẻ không hợp lệ.")
    if whole or n == int(n):
        return int(n)
    if n.normalize().as_tuple().exponent < -6:
        raise ValueError(f"{label} chỉ hỗ trợ tối đa 6 chữ số thập phân.")
    return float(n)


def line_amount(quantity, unit_price):
    units = 1 if quantity in ("", None) else quantity
    return int((Decimal(str(units)) * Decimal(str(unit_price))).to_integral_value(rounding=ROUND_HALF_UP))


def invoice_total(items):
    return sum(line_amount(i["quantity"], i["unit_price"]) for i in items)


def money(value):
    return f"{value:,}".replace(",", ".")


DIGITS = "không một hai ba bốn năm sáu bảy tám chín".split()


def triplet(n, padded):
    hundreds, rest = divmod(n, 100)
    tens, ones = divmod(rest, 10)
    parts = [DIGITS[hundreds], "trăm"] if hundreds or padded else []
    if tens >= 2:
        parts.extend([DIGITS[tens], "mươi"])
    elif tens:
        parts.append("mười")
    elif parts and ones:
        parts.append("lẻ")
    if ones:
        special = {1: "mốt", 4: "tư", 5: "lăm"} if tens >= 2 else {}
        parts.append("lăm" if tens and ones == 5 else special.get(ones, DIGITS[ones]))
    return parts


def vietnamese_words(amount):
    if amount < 0 or int(amount) != amount:
        raise ValueError("Số tiền phải là số nguyên không âm.")
    groups = []
    while amount:
        amount, group = divmod(int(amount), 1000)
        groups.append(group)
    words = []
    for index in reversed(range(len(groups))):
        if groups[index]:
            group_words = triplet(groups[index], bool(words))
            if index and group_words[-1] == "tư":
                group_words[-1] = "bốn"
            words.extend(group_words)
            scale = ("", "nghìn", "triệu")[index % 3]
            if scale:
                words.append(scale)
            words.extend(["tỷ"] * (index // 3))
    return (" ".join(words or ["không"]) + " đồng").capitalize()


def sanitize_filename(value):
    clean = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", value).strip(" .")
    clean = clean.encode("utf-16-le")[:240].decode("utf-16-le", "ignore").rstrip(" .") or "Khách lẻ"
    if re.fullmatch(r"(?:CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³])(?:\..*)?", clean, re.I):
        clean = "_" + clean
    return clean


def invoice_id(customer, when, existing=()):
    name = sanitize_filename(customer).encode("utf-16-le")[:180].decode("utf-16-le", "ignore")
    base = f"{name}_{when:%Y%m%d_%H%M}"
    used = {key.casefold() for key in existing}
    candidate = base
    index = 1
    while candidate.casefold() in used:
        index += 1
        candidate = f"{base}_{index}"
    return candidate


def today():
    return datetime.now().strftime("%d/%m/%Y")


def valid_date(value):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).strftime("%d/%m/%Y")
        except ValueError:
            pass
    raise ValueError("Ngày không hợp lệ. Vui lòng nhập theo dạng ngày/tháng/năm.")

