from .storage import atomic_path


def read_products(path, normalize):
    from openpyxl import load_workbook

    required = ("ten hang", "don vi tinh", "gia goc", "gia ban")
    try:
        book = load_workbook(path, read_only=True, data_only=True)
        try:
            rows = book.active.values
            header = [normalize(v or "") for v in next(rows, ())]
            if any(header.count(key) != 1 for key in required):
                raise ValueError("Cần đủ bốn cột duy nhất: Tên hàng, Đơn vị tính, Giá gốc, Giá bán.")
            indices = [header.index(key) for key in required]
            return [tuple(row[i] if i < len(row) else None for i in indices)
                    for row in rows if any(v is not None for v in row)]
        finally:
            book.close()
    except Exception as exc:
        raise ValueError(f"Không thể nhập bảng Excel. {exc}") from exc


HEADERS = ("STT", "Tên hàng", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền", "Ngày xuất")


def item_rows(record):
    for index, item in enumerate(record["items"], 1):
        yield (index, item["name"], item["unit"], item["quantity"], item["unit_price"],
               item["amount"], item["export_date"])


def write_excel(path, code, record, words):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    book = Workbook()
    sheet = book.active
    sheet.title = "Bảng kê"
    sheet.sheet_view.showGridLines = False

    def banner(row, value, size=11):
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=7)
        cell = sheet.cell(row, 1, value)
        cell.data_type = "s"
        cell.font = Font(name="Calibri", size=size, bold=row == 1, color="174940")
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        sheet.row_dimensions[row].height = 32

    banner(1, "BẢNG KÊ BÁN HÀNG", 18)
    banner(2, f"Mã hóa đơn: {code}")
    banner(3, f"Khách hàng: {record['customer']}")
    banner(4, f"Ngày lập: {record['date']}     •     Ngày chốt đơn: {record['input_date']}")
    sheet.append(HEADERS)
    for cell in sheet[5]:
        cell.fill = PatternFill("solid", fgColor="175747")
        cell.font = Font(color="FFFFFF", bold=True)
    for values in item_rows(record):
        sheet.append(values)
        for cell in sheet[sheet.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = "s"
        for col in (5, 6):
            sheet.cell(sheet.max_row, col).number_format = "#,##0"
    sheet.append([None, "Tổng cộng", None, None, None, record["total"]])
    sheet.cell(sheet.max_row, 6).number_format = "#,##0"
    for cell in sheet[sheet.max_row]:
        cell.font = Font(bold=True, color="175747")
    banner(sheet.max_row + 1, "Bằng chữ: " + words)
    for index, width in enumerate((7, 36, 12, 13, 18, 20, 17), 1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = "C6"
    sheet.print_title_rows = "5:5"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    with atomic_path(path) as tmp:
        book.save(tmp)


def write_word(path, code, record, words, format_money):
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.shared import Cm, Pt

    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.left_margin = section.right_margin = Cm(1.7)
    doc.styles["Normal"].font.name = "Arial"
    doc.styles["Normal"].font.size = Pt(10)
    doc.add_paragraph("CỬA HÀNG VẬT TƯ ____________________")
    doc.add_paragraph("HÓA ĐƠN BÁN LẺ", "Title").alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph(f"Mã hóa đơn: {code}\nKhách hàng: {record['customer']}")
    doc.add_paragraph(f"Ngày lập: {record['date']}     •     Ngày chốt đơn: {record['input_date']}")
    table = doc.add_table(rows=0, cols=7)
    table.style = "Light Shading Accent 1"
    table.autofit = False
    widths = (0.9, 4.6, 1.4, 1.8, 2.9, 3.4, 2.6)
    for col, width in zip(table.columns, widths):
        col.width = Cm(width)

    def add(values):
        row = table.add_row()
        for idx, (cell, value, width) in enumerate(zip(row.cells, values, widths)):
            cell.width = Cm(width)
            cell.text = "" if value is None else str(value)
            if idx in (3, 4, 5):
                cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        return row

    add(HEADERS)._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for values in item_rows(record):
        add((*values[:4], format_money(values[4]), format_money(values[5]), values[6]))
    doc.add_paragraph().add_run(f"Tổng cộng: {format_money(record['total'])} đồng").bold = True
    doc.add_paragraph("Bằng chữ: " + words)
    signatures = doc.add_table(rows=1, cols=2)
    for cell, role in zip(signatures.rows[0].cells, ("Người mua hàng", "Người bán hàng")):
        paragraph = cell.paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run(role).bold = True
        paragraph.add_run("\n(Ký, ghi rõ họ tên)").italic = True
    with atomic_path(path) as tmp:
        doc.save(tmp)

