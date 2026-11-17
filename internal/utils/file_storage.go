package utils

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// JSONStore là bộ đọc/ghi một file JSON an toàn luồng.
//
//   - Dữ liệu được nạp vào bộ nhớ (in-memory cache) khi khởi động.
//   - Thao tác đọc dùng RLock(): nhiều request đọc chạy song song.
//   - Thao tác ghi dùng Lock() độc quyền: các request ghi đồng thời được xếp hàng tuần tự,
//     không bao giờ ghi đè mất dữ liệu của nhau.
//   - Ghi nguyên tử (atomic write): ghi ra file .tmp, fsync, rồi Rename đè lên file chính,
//     nên file JSON không bao giờ bị hỏng giữa chừng khi mất điện.
//   - Nếu file bị sửa tay từ bên ngoài khi server đang chạy, dữ liệu sẽ được nạp lại tự động.
type JSONStore[T any] struct {
	mu      sync.RWMutex
	path    string
	value   T
	modTime time.Time
	size    int64
}

// OpenJSONStore mở (hoặc tạo mới với giá trị mặc định) một file JSON.
func OpenJSONStore[T any](path string, defaultValue T) (*JSONStore[T], error) {
	s := &JSONStore[T]{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		s.value = defaultValue
		if err := s.writeLocked(defaultValue); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err := s.reloadLocked(); err != nil {
		return nil, err
	}
	return s, nil
}

// Path trả về đường dẫn file.
func (s *JSONStore[T]) Path() string { return s.path }

// View cho phép đọc dữ liệu dưới khóa đọc RLock(). Hàm fn KHÔNG được sửa đổi dữ liệu.
func (s *JSONStore[T]) View(fn func(v T)) {
	s.refreshIfChanged()
	s.mu.RLock()
	defer s.mu.RUnlock()
	fn(s.value)
}

// Update sửa dữ liệu dưới khóa ghi độc quyền Lock().
// fn nhận giá trị hiện tại và trả về giá trị mới; fn phải sao chép (clone) trước khi sửa
// để bộ nhớ không bị thay đổi nếu fn trả lỗi hoặc ghi file thất bại.
// Bộ nhớ chỉ được cập nhật sau khi đã ghi file thành công.
func (s *JSONStore[T]) Update(fn func(current T) (T, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.staleLocked() {
		if err := s.reloadLocked(); err != nil {
			log.Printf("[CẢNH BÁO] Không nạp lại được %s: %v", s.path, err)
		}
	}
	next, err := fn(s.value)
	if err != nil {
		return err
	}
	if err := s.writeLocked(next); err != nil {
		return fmt.Errorf("không ghi được file %s: %w", filepath.Base(s.path), err)
	}
	s.value = next
	return nil
}

// refreshIfChanged nạp lại dữ liệu nếu file trên đĩa bị thay đổi từ bên ngoài.
func (s *JSONStore[T]) refreshIfChanged() {
	s.mu.RLock()
	stale := s.staleLocked()
	s.mu.RUnlock()
	if !stale {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.staleLocked() {
		if err := s.reloadLocked(); err != nil {
			log.Printf("[CẢNH BÁO] File %s bị thay đổi nhưng không đọc được, giữ dữ liệu cũ: %v", s.path, err)
			s.rememberStat() // tránh log lặp lại liên tục
		}
	}
}

func (s *JSONStore[T]) staleLocked() bool {
	info, err := os.Stat(s.path)
	if err != nil {
		return false
	}
	return !info.ModTime().Equal(s.modTime) || info.Size() != s.size
}

func (s *JSONStore[T]) rememberStat() {
	if info, err := os.Stat(s.path); err == nil {
		s.modTime, s.size = info.ModTime(), info.Size()
	}
}

func (s *JSONStore[T]) reloadLocked() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf")) // bỏ BOM nếu file bị sửa bằng Notepad
	var v T
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &v); err != nil {
			return fmt.Errorf("file %s sai định dạng JSON: %w", s.path, err)
		}
	}
	s.value = v
	s.rememberStat()
	return nil
}

// writeLocked ghi nguyên tử: file tạm -> fsync -> rename đè file chính.
func (s *JSONStore[T]) writeLocked(v T) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(buf.Bytes()); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	// Trên Windows, Rename có thể thất bại tạm thời nếu phần mềm diệt virus / trình soạn thảo
	// đang mở file -> thử lại vài lần.
	for attempt := 0; ; attempt++ {
		err = os.Rename(tmp, s.path)
		if err == nil || attempt >= 10 {
			break
		}
		time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	s.rememberStat()
	return nil
}

// BackupFiles sao lưu các file dữ liệu vào backupDir/YYYYMMDD (mỗi ngày 1 bản),
// và chỉ giữ lại `keep` bản gần nhất.
func BackupFiles(backupDir string, keep int, files ...string) (string, error) {
	day := time.Now().Format("20060102")
	target := filepath.Join(backupDir, day)
	if _, err := os.Stat(target); err == nil {
		return "", nil // hôm nay đã sao lưu
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", err
	}
	for _, src := range files {
		if err := copyFile(src, filepath.Join(target, filepath.Base(src))); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	entries, err := os.ReadDir(backupDir)
	if err == nil {
		var days []string
		for _, e := range entries {
			if e.IsDir() && len(e.Name()) == 8 && strings.Trim(e.Name(), "0123456789") == "" {
				days = append(days, e.Name())
			}
		}
		sort.Strings(days)
		for len(days) > keep {
			os.RemoveAll(filepath.Join(backupDir, days[0]))
			days = days[1:]
		}
	}
	return target, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
