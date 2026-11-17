package utils

import (
	"strings"
	"unicode"
)

// Bảng chuyển chữ cái tiếng Việt có dấu về chữ không dấu.
var vietnameseBase = map[rune]rune{}

func init() {
	groups := map[rune]string{
		'a': "àáạảãâầấậẩẫăằắặẳẵ",
		'e': "èéẹẻẽêềếệểễ",
		'i': "ìíịỉĩ",
		'o': "òóọỏõôồốộổỗơờớợởỡ",
		'u': "ùúụủũưừứựửữ",
		'y': "ỳýỵỷỹ",
		'd': "đ",
	}
	for base, chars := range groups {
		for _, r := range chars {
			vietnameseBase[r] = base
			vietnameseBase[unicode.ToUpper(r)] = unicode.ToUpper(base)
		}
	}
}

// RemoveDiacritics bỏ dấu tiếng Việt ("Bác Hùng Thợ Điện" -> "Bac Hung Tho Dien").
// Hỗ trợ cả chữ dựng sẵn (NFC) lẫn chữ tổ hợp (dấu rời U+0300..U+036F).
func RemoveDiacritics(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r >= 0x0300 && r <= 0x036F { // dấu tổ hợp
			continue
		}
		if base, ok := vietnameseBase[r]; ok {
			r = base
		}
		b.WriteRune(r)
	}
	return b.String()
}

// NormalizeSearch chuẩn hóa chuỗi để tìm kiếm: bỏ dấu, chữ thường, gộp khoảng trắng.
func NormalizeSearch(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(RemoveDiacritics(s))), " ")
}

// SanitizeCustomerName tạo phần tên trong mã hóa đơn: bỏ dấu, bỏ ký tự đặc biệt,
// viết hoa chữ cái đầu mỗi từ và nối liền.
//
//	"Bác Hùng Thợ Điện"          -> "BacHungThoDien"
//	"Anh Minh (Công trình số 8)" -> "AnhMinh"   (phần trong ngoặc là ghi chú, bị lược bỏ)
func SanitizeCustomerName(name string) string {
	result := pascalAlnum(stripBracketed(name))
	if result == "" {
		result = pascalAlnum(name)
	}
	if result == "" {
		result = "KhachLe"
	}
	if r := []rune(result); len(r) > 40 {
		result = string(r[:40])
	}
	return result
}

func stripBracketed(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch r {
		case '(', '[', '{':
			depth++
			continue
		case ')', ']', '}':
			if depth > 0 {
				depth--
			}
			continue
		}
		if depth == 0 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func pascalAlnum(s string) string {
	s = RemoveDiacritics(s)
	var b strings.Builder
	newWord := true
	for _, r := range s {
		isAlnum := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		if !isAlnum {
			newWord = true
			continue
		}
		if newWord {
			r = unicode.ToUpper(r)
			newWord = false
		}
		b.WriteRune(r)
	}
	return b.String()
}
