# -*- coding: utf-8 -*-
"""
个人任务清单 —— 网页版后端
仅依赖 Python 标准库（http.server），数据持久化到本地 tasks.json。
运行:  python app.py
访问:  http://127.0.0.1:8000
"""

import json
import os
import threading
import time
import uuid
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_FILE = os.path.join(BASE_DIR, "tasks.json")

# 已完成任务在多少小时后自动删除
AUTO_DELETE_HOURS = 12

_lock = threading.Lock()


def _now_iso():
    return datetime.now().isoformat(timespec="seconds")


def current_week_key(now=None):
    """返回当前 ISO 周年份与周数，如 '2026-W47'（周一为一周起点）。"""
    d = (now or datetime.now()).date()
    iso = d.isocalendar()
    return "%d-W%02d" % (iso[0], iso[1])


def _is_expired(task):
    """已完成且超过 AUTO_DELETE_HOURS 小时的任务视为过期。
    每周任务属于长期重复任务，不参与自动删除。"""
    if task.get("is_weekly"):
        return False
    if not task.get("done"):
        return False
    ca = task.get("completed_at")
    if not ca:
        return False
    try:
        dt = datetime.fromisoformat(ca)
    except ValueError:
        return False
    return datetime.now() - dt > timedelta(hours=AUTO_DELETE_HOURS)


def cleanup_expired(tasks):
    return [t for t in tasks if not _is_expired(t)]


def refresh_weekly(tasks, now=None):
    """按当前周同步每周任务的完成状态：
    本周已完成 → done=True；已进入新一周 → done=False（自动刷新）。"""
    week = current_week_key(now)
    for t in tasks:
        if t.get("is_weekly"):
            t["done"] = t.get("weekly_done_week") == week
    return tasks


def set_weekly_done(task, done, now=None):
    """处理每周任务的勾选/取消勾选，维护累计完成周期数 cycles。"""
    week = current_week_key(now)
    cycles = int(task.get("cycles", 0) or 0)
    if done:
        task["done"] = True
        if task.get("weekly_done_week") != week:
            # 本周首次完成 → 累计 +1
            task["weekly_done_week"] = week
            task["cycles"] = cycles + 1
    else:
        task["done"] = False
        if task.get("weekly_done_week") == week:
            # 取消本周完成 → 回退累计
            task["cycles"] = max(0, cycles - 1)
        task["weekly_done_week"] = None


# ------------------------- 数据存取 -------------------------
def load_tasks():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_tasks(tasks):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


# ------------------------- 请求处理 -------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "ToDoList/1.0"

    def _send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, rel_path, content_type):
        full = os.path.normpath(os.path.join(STATIC_DIR, rel_path))
        # 防止目录穿越
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    # ---------- 路由 ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self._send_static("index.html", "text/html; charset=utf-8")
        elif path.startswith("/static/"):
            self._serve_static_by_ext(path[len("/static/"):])
        elif path == "/api/tasks":
            with _lock:
                tasks = load_tasks()
                cleaned = cleanup_expired(tasks)
                refresh_weekly(cleaned)
                if len(cleaned) != len(tasks):
                    save_tasks(cleaned)
                self._send_json(200, cleaned)
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/tasks":
            data = self._read_body()
            title = (data.get("title") or "").strip()
            if not title:
                self._send_json(400, {"error": "标题不能为空"})
                return
            task = {
                "id": uuid.uuid4().hex,
                "title": title,
                "done": bool(data.get("done", False)),
                "priority": data.get("priority", "中"),
                "category": (data.get("category") or "").strip(),
                "due": (data.get("due") or "").strip(),
                "note": (data.get("note") or "").strip(),
                "created": data.get("created") or "",
                "is_weekly": bool(data.get("is_weekly", False)),
                "cycles": 0,
            }
            with _lock:
                tasks = load_tasks()
                tasks.append(task)
                save_tasks(tasks)
            self._send_json(201, task)
        else:
            self.send_error(404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tasks":
            task_id = parts[2]
            data = self._read_body()
            with _lock:
                tasks = load_tasks()
                updated = None
                for t in tasks:
                    if t["id"] == task_id:
                        for key in ("title", "priority", "category",
                                    "due", "note", "created"):
                            if key in data:
                                t[key] = data[key]
                        # 处理完成状态：勾选完成时记录时间，取消完成时清除
                        if "done" in data:
                            done = bool(data["done"])
                            if t.get("is_weekly"):
                                set_weekly_done(t, done)
                            else:
                                t["done"] = done
                                if done:
                                    if not t.get("completed_at"):
                                        t["completed_at"] = _now_iso()
                                else:
                                    t.pop("completed_at", None)
                        updated = t
                        break
                if updated is None:
                    self._send_json(404, {"error": "任务不存在"})
                    return
                save_tasks(tasks)
            self._send_json(200, updated)
        else:
            self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "tasks":
            task_id = parts[2]
            with _lock:
                tasks = load_tasks()
                new_tasks = [t for t in tasks if t["id"] != task_id]
                if len(new_tasks) == len(tasks):
                    self._send_json(404, {"error": "任务不存在"})
                    return
                save_tasks(new_tasks)
            self._send_json(200, {"ok": True})
        else:
            self.send_error(404)

    def _serve_static_by_ext(self, rel_path):
        ext = os.path.splitext(rel_path)[1].lower()
        mime = {
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")
        self._send_static(rel_path, mime)

    def log_message(self, format, *args):
        print("[%s] %s" % (self.log_date_time_string(), format % args))


def _cleanup_loop():
    """后台线程：每分钟检查一次，自动删除已过期任务。"""
    while True:
        time.sleep(60)
        try:
            with _lock:
                tasks = load_tasks()
                cleaned = cleanup_expired(tasks)
                if len(cleaned) != len(tasks):
                    save_tasks(cleaned)
        except Exception as e:  # noqa: BLE001
            print("自动清理失败:", e)


def main():
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    # 启动后台自动清理线程
    cleaner = threading.Thread(target=_cleanup_loop, daemon=True)
    cleaner.start()

    print("=" * 46)
    print("  个人任务清单已启动")
    print("  访问地址: http://127.0.0.1:%d" % port)
    print("  已完成任务将在 %d 小时后自动删除" % AUTO_DELETE_HOURS)
    print("  按 Ctrl+C 停止服务")
    print("=" * 46)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止服务")
        server.shutdown()


if __name__ == "__main__":
    main()
