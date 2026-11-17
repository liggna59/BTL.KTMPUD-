package utils

import (
	"math"
	"strings"
	"unicode"
	"unicode/utf8"
)

var digitWords = [10]string{"không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"}

// groupUnits là đơn vị của các nhóm 3 chữ số bên dưới hàng tỷ.
var groupUnits = [3]string{"", "nghìn", "triệu"}

const billion = 1_000_000_000

// readThreeDigits đọc một nhóm 3 chữ số (0..999).
// hasHigherGroup = true khi phía trước còn nhóm cao hơn, khi đó phải đọc đủ
// "không trăm" và "lẻ" (VD: 1.005.000 -> "một triệu không trăm lẻ năm nghìn").
func readThreeDigits(number int, hasHigherGroup bool) []string {
	hundred := number / 100
	remainder := number % 100
	ten := remainder / 10
	unit := remainder % 10
	var w []string

	if hundred > 0 || hasHigherGroup {
		w = append(w, digitWords[hundred], "trăm")
	}
	switch {
	case ten > 1:
		w = append(w, digitWords[ten], "mươi")
		switch {
		case unit == 1:
			w = append(w, "mốt")
		case unit == 5:
			w = append(w, "lăm")
		case unit > 0:
			w = append(w, digitWords[unit])
		}
	case ten == 1:
		w = append(w, "mười")
		switch {
		case unit == 5:
			w = append(w, "lăm")
		case unit > 0:
			w = append(w, digitWords[unit])
		}
	case unit > 0: // ten == 0
		if hundred > 0 || hasHigherGroup {
			w = append(w, "lẻ")
		}
		w = append(w, digitWords[unit])
	}
	return w
}

// readBelowBillion đọc số 0..999.999.999 theo các nhóm triệu - nghìn - đơn vị.
func readBelowBillion(n uint64, hasHigher bool) []string {
	groups := [3]int{int(n % 1000), int(n / 1000 % 1000), int(n / 1_000_000)}
	var w []string
	started := hasHigher
	for i := 2; i >= 0; i-- {
		g := groups[i]
		if g == 0 {
			continue
		}
		w = append(w, readThreeDigits(g, started)...)
		if groupUnits[i] != "" {
			w = append(w, groupUnits[i])
		}
		started = true
	}
	return w
}

// readNumber đọc số nguyên không âm bất kỳ; phần từ hàng tỷ trở lên được đọc đệ quy
// (VD: 2.003.000.000.000 -> "hai nghìn không trăm lẻ ba tỷ").
func readNumber(n uint64, hasHigher bool) []string {
	if n < billion {
		return readBelowBillion(n, hasHigher)
	}
	w := readNumber(n/billion, hasHigher)
	w = append(w, "tỷ")
	if low := n % billion; low > 0 {
		w = append(w, readBelowBillion(low, true)...)
	}
	return w
}

// NumberToVietnameseWords đọc số tiền (VNĐ) thành chữ tiếng Việt chuẩn ngữ pháp tài chính,
// viết hoa chữ cái đầu và kết thúc bằng "đồng chẵn".
//
//	950000  -> "Chín trăm năm mươi nghìn đồng chẵn"
//	1850000 -> "Một triệu tám trăm năm mươi nghìn đồng chẵn"
func NumberToVietnameseWords(amount float64) string {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return ""
	}
	rounded := math.Round(math.Abs(amount))
	if rounded == 0 {
		return "Không đồng chẵn"
	}
	if rounded >= 1e18 {
		return ""
	}
	text := strings.Join(readNumber(uint64(rounded), false), " ")
	if amount < 0 {
		text = "âm " + text
	}
	return capitalizeFirst(text) + " đồng chẵn"
}

func capitalizeFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}
