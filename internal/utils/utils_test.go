package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestNumberToVietnameseWords(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "tests", "testdata", "number_words.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Amount float64 `json:"amount"`
		Words  string  `json:"words"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if got := NumberToVietnameseWords(c.Amount); got != c.Words {
			t.Errorf("NumberToVietnameseWords(%v)\n  got:  %q\n  want: %q", c.Amount, got, c.Words)
		}
	}
}

func TestSanitizeCustomerName(t *testing.T) {
	cases := map[string]string{
		"Bác Hùng Thợ Điện":          "BacHungThoDien",
		"Anh Minh (Công trình số 8)": "AnhMinh",
		"Khách lẻ":                   "KhachLe",
		"":                           "KhachLe",
		"!!!":                        "KhachLe",
		"(Công trình 5)":             "CongTrinh5",
		"chị  ngọc   ánh":            "ChiNgocAnh",
		"Đặng Văn Ơn":                "DangVanOn",
		"Cty TNHH Xây dựng Đại Phát": "CtyTNHHXayDungDaiPhat",
		"Nguyễn Văn A":            "NguyenVanA", // chữ tổ hợp (NFD)
	}
	for in, want := range cases {
		if got := SanitizeCustomerName(in); got != want {
			t.Errorf("SanitizeCustomerName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeSearch(t *testing.T) {
	if got := NormalizeSearch("  Ống NHỰA   Tiền Phong "); got != "ong nhua tien phong" {
		t.Errorf("got %q", got)
	}
}

func TestJSONStoreCreatesFileWithDefault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "x.json")
	s, err := OpenJSONStore(path, []string{})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != "[]\n" {
		t.Fatalf("file content = %q", raw)
	}
	s.View(func(v []string) {
		if len(v) != 0 {
			t.Fatal("expected empty")
		}
	})
}

// Nhiều goroutine cùng ghi đồng thời: không được mất bản ghi nào (TC14).
func TestJSONStoreConcurrentUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	s, err := OpenJSONStore(path, []int{})
	if err != nil {
		t.Fatal(err)
	}
	const writers = 100
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			err := s.Update(func(cur []int) ([]int, error) {
				return append(slices.Clone(cur), n), nil
			})
			if err != nil {
				t.Error(err)
			}
		}(i)
		// đọc song song trong lúc ghi
		go s.View(func(v []int) { _ = len(v) })
	}
	wg.Wait()

	// Mở lại từ đĩa để chắc chắn dữ liệu đã được ghi đầy đủ.
	reopened, err := OpenJSONStore(path, []int{})
	if err != nil {
		t.Fatal(err)
	}
	reopened.View(func(v []int) {
		if len(v) != writers {
			t.Fatalf("có %d bản ghi, mong đợi %d", len(v), writers)
		}
		seen := map[int]bool{}
		for _, n := range v {
			seen[n] = true
		}
		if len(seen) != writers {
			t.Fatalf("bị trùng/mất bản ghi: %d giá trị khác nhau", len(seen))
		}
	})
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("file .tmp vẫn còn sau khi ghi")
	}
}

func TestJSONStoreUpdateErrorKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	s, _ := OpenJSONStore(path, []int{1, 2})
	err := s.Update(func(cur []int) ([]int, error) { return nil, fmt.Errorf("boom") })
	if err == nil {
		t.Fatal("expected error")
	}
	s.View(func(v []int) {
		if len(v) != 2 {
			t.Fatalf("dữ liệu bị thay đổi dù cập nhật lỗi: %v", v)
		}
	})
}

func TestJSONStoreReloadsExternalChangeAndBOM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data.json")
	s, _ := OpenJSONStore(path, []string{"a"})
	time.Sleep(20 * time.Millisecond)
	// Sửa tay file (kèm BOM như Notepad) khi server đang chạy.
	if err := os.WriteFile(path, []byte("\xef\xbb\xbf[\"a\",\"b\",\"c\"]"), 0o644); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(path, future, future)
	s.View(func(v []string) {
		if len(v) != 3 {
			t.Fatalf("không nạp lại được thay đổi bên ngoài: %v", v)
		}
	})
}

func TestJSONStoreRejectsCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	_ = os.WriteFile(path, []byte("[{\"broken\": "), 0o644)
	if _, err := OpenJSONStore(path, []int{}); err == nil {
		t.Fatal("phải báo lỗi khi file JSON hỏng")
	}
}

func TestBackupFiles(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "a.json")
	_ = os.WriteFile(src, []byte("[]"), 0o644)
	backupDir := filepath.Join(dir, "backups")
	// tạo sẵn các bản sao lưu cũ
	for _, d := range []string{"20200101", "20200102", "20200103"} {
		_ = os.MkdirAll(filepath.Join(backupDir, d), 0o755)
	}
	target, err := BackupFiles(backupDir, 2, src, filepath.Join(dir, "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target, "a.json")); err != nil {
		t.Fatal("không có file sao lưu")
	}
	entries, _ := os.ReadDir(backupDir)
	if len(entries) != 2 {
		t.Fatalf("phải giữ 2 bản sao lưu, còn %d", len(entries))
	}
}
