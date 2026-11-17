package models

import "errors"

// Settings là thông tin cửa hàng in trên đầu hóa đơn (lưu ở data/settings.json).
type Settings struct {
	StoreName    string `json:"store_name"`
	Address      string `json:"address"`
	Phone        string `json:"phone"`
	InvoiceTitle string `json:"invoice_title"`
	FooterNote   string `json:"footer_note"`
}

// DefaultSettings là cấu hình mặc định khi chưa thiết lập.
func DefaultSettings() Settings {
	return Settings{
		StoreName:    "CỬA HÀNG VẬT TƯ XÂY DỰNG - ĐIỆN NƯỚC",
		Address:      "Địa chỉ: ......................................................",
		Phone:        "Điện thoại: ....................",
		InvoiceTitle: "HÓA ĐƠN BÁN LẺ",
		FooterNote:   "Cảm ơn quý khách đã mua hàng!",
	}
}

// Normalize làm sạch và kiểm tra độ dài các trường cấu hình.
func (s *Settings) Normalize() error {
	s.StoreName = CleanText(s.StoreName)
	s.Address = CleanText(s.Address)
	s.Phone = CleanText(s.Phone)
	s.InvoiceTitle = CleanText(s.InvoiceTitle)
	s.FooterNote = CleanText(s.FooterNote)
	if s.InvoiceTitle == "" {
		s.InvoiceTitle = DefaultSettings().InvoiceTitle
	}
	for _, v := range []string{s.StoreName, s.Address, s.Phone, s.InvoiceTitle, s.FooterNote} {
		if len([]rune(v)) > 200 {
			return errors.New("Thông tin cửa hàng quá dài (mỗi trường tối đa 200 ký tự)")
		}
	}
	return nil
}
