package models

import (
	"errors"
	"math"
	"strings"
)

// Product là một mặt hàng trong thư viện vật tư dùng chung.
type Product struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Unit         string  `json:"unit"`
	CostPrice    float64 `json:"cost_price"`
	SellingPrice float64 `json:"selling_price"`
	CreatedAt    string  `json:"created_at,omitempty"`
}

// ProductInput là dữ liệu client gửi lên khi thêm/sửa mặt hàng.
// Dùng con trỏ để phân biệt "không gửi" với "gửi giá trị 0" (phục vụ cập nhật một phần).
type ProductInput struct {
	Name         *string  `json:"name"`
	Unit         *string  `json:"unit"`
	CostPrice    *float64 `json:"cost_price"`
	SellingPrice *float64 `json:"selling_price"`
}

const (
	MaxNameLength = 200
	MaxUnitLength = 30
)

// ApplyTo ghi các trường có trong input lên product (đã chuẩn hóa khoảng trắng).
func (in ProductInput) ApplyTo(p *Product) {
	if in.Name != nil {
		p.Name = CleanText(*in.Name)
	}
	if in.Unit != nil {
		p.Unit = CleanText(*in.Unit)
	}
	if in.CostPrice != nil {
		p.CostPrice = *in.CostPrice
	}
	if in.SellingPrice != nil {
		p.SellingPrice = *in.SellingPrice
	}
}

// Validate kiểm tra ràng buộc nghiệp vụ của một mặt hàng.
func (p Product) Validate() error {
	switch {
	case p.Name == "":
		return errors.New("Tên vật tư không được để trống")
	case len([]rune(p.Name)) > MaxNameLength:
		return errors.New("Tên vật tư quá dài (tối đa 200 ký tự)")
	case p.Unit == "":
		return errors.New("Đơn vị tính không được để trống")
	case len([]rune(p.Unit)) > MaxUnitLength:
		return errors.New("Đơn vị tính quá dài (tối đa 30 ký tự)")
	case !validMoney(p.CostPrice):
		return errors.New("Giá vốn phải là số lớn hơn hoặc bằng 0")
	case !validMoney(p.SellingPrice):
		return errors.New("Giá bán phải là số lớn hơn hoặc bằng 0")
	}
	return nil
}

func validMoney(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v < 1e15
}

// CleanText cắt khoảng trắng hai đầu và gộp các khoảng trắng liên tiếp.
func CleanText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// NameKey là khóa so khớp tên hàng: không phân biệt hoa/thường và khoảng trắng thừa.
func NameKey(s string) string {
	return strings.ToLower(CleanText(s))
}
