import json
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile


@contextmanager
def atomic_path(target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=target.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        yield temporary
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


class Storage:
    def __init__(self, root):
        self.folder = Path(root) / "app_data"
        self.exports = Path(root) / "hoa_don_xuat"

    def initialize(self):
        for folder in (self.folder, self.exports):
            folder.mkdir(parents=True, exist_ok=True)

    def exported_ids(self):
        return {p.stem for p in self.exports.iterdir() if p.suffix.lower() in (".docx", ".xlsx")}

    def export_path(self, safe_code, kind):
        if kind not in ("docx", "xlsx"):
            raise ValueError("Định dạng xuất không hợp lệ.")
        return self.exports / f"{safe_code}.{kind}"

    def remove_exports(self, safe_code):
        for kind in ("docx", "xlsx"):
            try:
                self.export_path(safe_code, kind).unlink(missing_ok=True)
            except OSError:
                pass

    def read(self, collection):
        path = self.folder / f"{collection}_data.json"
        try:
            with path.open(encoding="utf-8-sig") as stream:
                result = json.load(stream)
            if not isinstance(result, dict):
                raise ValueError("Nội dung phải là một đối tượng JSON.")
            return result
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as exc:
            raise ValueError(f"Không đọc được {path.name}. {exc}") from exc

    def write(self, collection, value):
        target = self.folder / f"{collection}_data.json"
        with atomic_path(target) as tmp:
            tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")

