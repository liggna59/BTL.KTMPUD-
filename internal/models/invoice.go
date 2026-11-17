package models

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// InvoiceItem là một dòng hàng hóa / dịch vụ trong hóa đơn.
// Quantity = nil nghĩa là BÁN KHOÁN: Thành tiền = Đơn giá.
type InvoiceItem struct {
	LineNumber  int      `json:"line_number"`
	ProductName string   `json:"product_name"`
	Unit        string   `json:"unit"`
	Quantity    *float64 `json:"quantity"`
	UnitPrice   float64  `json:"unit_price"`
	TotalPrice  float64  `json:"total_price"`
	IsLumpSum   bool     `json:"is_lump_sum"`
}

// Invoice là phiếu bán hàng hoàn chỉnh được lưu vào lịch sử.
type Invoice struct {
	ID            string        `json:"id"`
	CustomerName  string        `json:"customer_name"`
	InvoiceDate   string        `json:"invoice_date"`
	Items         []InvoiceItem `json:"items"`
	TotalAmount   float64       `json:"total_amount"`
	AmountInWords string        `json:"amount_in_words"`
	Note          string        `json:"note,omitempty"`
	CreatedAt     string        `json:"created_at"`
	UpdatedAt     string        `json:"updated_at,omitempty"`
}

// InvoiceSummary là bản tóm tắt dùng cho danh sách lịch sử hóa đơn.
type InvoiceSummary struct {
	ID           string  `json:"id"`
	CustomerName string  `json:"customer_name"`
	InvoiceDate  string  `json:"invoice_date"`
	TotalAmount  float64 `json:"total_amount"`
	ItemsCount   int     `json:"items_count"`
	Note         string  `json:"note,omitempty"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at,omitempty"`
}

// Summary tạo bản tóm tắt của hóa đơn.
func (inv Invoice) Summary() InvoiceSummary {
	return InvoiceSummary{
		ID:           inv.ID,
		CustomerName: inv.CustomerName,
		InvoiceDate:  inv.InvoiceDate,
		TotalAmount:  inv.TotalAmount,
		ItemsCount:   len(inv.Items),
		Note:         inv.Note,
		CreatedAt:    inv.CreatedAt,
		UpdatedAt:    inv.UpdatedAt,
	}
}

// DefaultCustomerName được gán khi thu ngân để trống tên khách hàng.
const DefaultCustomerName = "Khách lẻ"

const (
	MaxItemsPerInvoice = 500
	MaxNoteLength      = 500
	MaxCustomerLength  = 150
)

// ---------------------------------------------------------------------------
// Dữ liệu client gửi lên (cho phép quantity/unit_price ở dạng số, chuỗi số, rỗng hoặc null)
// ---------------------------------------------------------------------------

// InvoiceItemInput là một dòng hàng trong request tạo/cập nhật hóa đơn.
type InvoiceItemInput struct {
	LineNumber  int             `json:"line_number"`
	ProductName string          `json:"product_name"`
	Unit        string          `json:"unit"`
	Quantity    json.RawMessage `json:"quantity"`
	UnitPrice   json.RawMessage `json:"unit_price"`
}

// InvoiceInput là body của POST/PUT /api/invoices.
type InvoiceInput struct {
	CustomerName string             `json:"customer_name"`
	InvoiceDate  string             `json:"invoice_date"`
	Items        []InvoiceItemInput `json:"items"`
	Note         string             `json:"note"`
}

// ValidationError là lỗi dữ liệu đầu vào (trả về HTTP 400).
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, args...)}
}

// IsValidationError kiểm tra lỗi có phải do dữ liệu đầu vào không hợp lệ.
func IsValidationError(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve)
}

// CalculateLineItem tính Thành tiền cho một dòng hàng (thuật toán mục 5.1 của đặc tả).
//   - quantity == nil  -> BÁN KHOÁN: totalPrice = unitPrice, isLumpSum = true
//   - quantity <= 0    -> totalPrice = 0
//   - còn lại          -> totalPrice = round(quantity * unitPrice)
func CalculateLineItem(quantity *float64, unitPrice float64) (totalPrice float64, isLumpSum bool) {
	if quantity == nil {
		return unitPrice, true
	}
	qty := *quantity
	if math.IsNaN(qty) || qty <= 0 {
		return 0, false
	}
	return math.Round(qty * unitPrice), false
}

// BuildItems kiểm tra và chuẩn hóa danh sách dòng hàng, đồng thời TÍNH LẠI toàn bộ
// thành tiền phía server (không tin số liệu client gửi lên). Trả về các dòng hàng và tổng tiền.
func (in InvoiceInput) BuildItems() ([]InvoiceItem, float64, error) {
	if len(in.Items) == 0 {
		return nil, 0, invalid("Hóa đơn phải có ít nhất 1 dòng hàng")
	}
	if len(in.Items) > MaxItemsPerInvoice {
		return nil, 0, invalid("Hóa đơn có quá nhiều dòng hàng (tối đa %d)", MaxItemsPerInvoice)
	}
	items := make([]InvoiceItem, 0, len(in.Items))
	var total float64
	for i, raw := range in.Items {
		line := i + 1
		name := CleanText(raw.ProductName)
		if name == "" {
			return nil, 0, invalid("Dòng %d: Tên hàng hóa, vật tư không được để trống", line)
		}
		if len([]rune(name)) > MaxNameLength {
			return nil, 0, invalid("Dòng %d: Tên hàng quá dài (tối đa %d ký tự)", line, MaxNameLength)
		}
		unit := CleanText(raw.Unit)
		if len([]rune(unit)) > MaxUnitLength {
			return nil, 0, invalid("Dòng %d: Đơn vị tính quá dài (tối đa %d ký tự)", line, MaxUnitLength)
		}

		price, present, err := parseFlexibleNumber(raw.UnitPrice)
		if err != nil || !present {
			return nil, 0, invalid("Dòng %d: Đơn giá phải là số", line)
		}
		if !validMoney(price) {
			return nil, 0, invalid("Dòng %d: Đơn giá phải lớn hơn hoặc bằng 0", line)
		}

		qtyVal, qtyPresent, err := parseFlexibleNumber(raw.Quantity)
		if err != nil {
			return nil, 0, invalid("Dòng %d: Số lượng phải là số hoặc để trống (bán khoán)", line)
		}
		var qty *float64
		if qtyPresent {
			if qtyVal < 0 || qtyVal > 1e9 {
				return nil, 0, invalid("Dòng %d: Số lượng không hợp lệ", line)
			}
			q := qtyVal
			qty = &q
		}

		lineTotal, lump := CalculateLineItem(qty, price)
		items = append(items, InvoiceItem{
			LineNumber:  line,
			ProductName: name,
			Unit:        unit,
			Quantity:    qty,
			UnitPrice:   price,
			TotalPrice:  lineTotal,
			IsLumpSum:   lump,
		})
		total += lineTotal
	}
	return items, math.Round(total), nil
}

// NormalizeHeader chuẩn hóa tên khách, ngày lập và ghi chú của hóa đơn.
func (in InvoiceInput) NormalizeHeader(now time.Time) (customer, date, note string, err error) {
	customer = CleanText(in.CustomerName)
	if customer == "" {
		customer = DefaultCustomerName
	}
	if len([]rune(customer)) > MaxCustomerLength {
		return "", "", "", invalid("Tên khách hàng quá dài (tối đa %d ký tự)", MaxCustomerLength)
	}
	date = strings.TrimSpace(in.InvoiceDate)
	if date == "" {
		date = now.Format("2006-01-02")
	} else if _, perr := time.Parse("2006-01-02", date); perr != nil {
		return "", "", "", invalid("Ngày lập hóa đơn không hợp lệ (định dạng YYYY-MM-DD)")
	}
	note = strings.TrimSpace(in.Note)
	if len([]rune(note)) > MaxNoteLength {
		return "", "", "", invalid("Ghi chú quá dài (tối đa %d ký tự)", MaxNoteLength)
	}
	return customer, date, note, nil
}

// parseFlexibleNumber đọc một giá trị JSON có thể là số, chuỗi số, chuỗi rỗng hoặc null.
// present = false khi giá trị vắng mặt / null / chuỗi rỗng.
func parseFlexibleNumber(raw json.RawMessage) (value float64, present bool, err error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return 0, false, nil
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return 0, false, err
		}
		s = strings.TrimSpace(s)
		if s == "" {
			return 0, false, nil
		}
		s = strings.ReplaceAll(s, ",", ".")
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			return 0, false, errors.New("not a number")
		}
		return v, true, nil
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, false, err
	}
	return v, true, nil
}
