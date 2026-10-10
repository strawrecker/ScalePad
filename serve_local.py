"""在本机电脑上运行 ScalePad：只监听 127.0.0.1，用 http://127.0.0.1 打开（localhost 不需要证书）。

除静态文件外多两个接口，供“追加进汇总表”按钮使用，省去导出后再手动跑合并脚本：
    GET  /api/desktop                       → {"ok": true, "dest": 默认汇总表文件夹}
    POST /api/merge?name=文件名&dest=文件夹  请求体为 xlsx → 原件存一份到 ScalePad导出/，再追加进汇总表
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import sys
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DEFAULT_DEST = Path(os.path.expanduser("~")) / "Desktop" / "numerical cognition"
sys.path.insert(0, str(ROOT / "tools"))

try:
    from merge_numerical_xlsx import merge
except SystemExit as error:  # 缺 openpyxl 时合并脚本会 sys.exit，网页照常可用，只是不能追加
    merge = None
    MERGE_ERROR = str(error)
else:
    MERGE_ERROR = ""


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/api/desktop":
            self.send_json(200, {"ok": True, "dest": str(DEFAULT_DEST), "mergeError": MERGE_ERROR})
            return
        super().do_GET()

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path != "/api/merge":
            self.send_json(404, {"ok": False, "message": "not found"})
            return
        if merge is None:
            self.send_json(500, {"ok": False, "message": MERGE_ERROR})
            return
        query = parse_qs(url.query)
        name = Path(query.get("name", [""])[0]).name
        if not name.endswith(".xlsx"):
            self.send_json(400, {"ok": False, "message": "文件名必须是 .xlsx"})
            return
        dest = Path(os.path.expanduser(query.get("dest", [""])[0].strip() or str(DEFAULT_DEST)))
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length)
        try:
            dest.mkdir(parents=True, exist_ok=True)
            # 原件留底：汇总表万一被改坏，还能从这里重新合并
            archive = DEFAULT_DEST / "ScalePad导出"
            archive.mkdir(parents=True, exist_ok=True)
            source = archive / name
            source.write_bytes(data)
            message = merge(source, dest)
        except Exception as error:  # noqa: BLE001 - 原样告诉网页，便于医生看到
            self.send_json(500, {"ok": False, "message": f"{type(error).__name__}: {error}"})
            return
        print(message)
        self.send_json(200, {"ok": True, "message": message, "archived": str(source)})


class ReusableHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description="ScalePad 本机网页服务")
    parser.add_argument("--port", type=int, default=47815)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=str(ROOT))
    server = ReusableHTTPServer(("127.0.0.1", args.port), handler)
    address = f"http://127.0.0.1:{args.port}/"
    print(f"ScalePad 已在本机运行：{address}")
    if MERGE_ERROR:
        print(f"注意：{MERGE_ERROR}（不影响答题，只是不能一键追加进汇总表）")
    print("测试期间请保持这个窗口打开；关闭窗口即停止。")
    if not args.no_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
