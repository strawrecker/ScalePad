"""打包发给别人用的两版 ScalePad（Windows / Mac 通用）：

    python3 tools/build_release.py

在 dist/ 下生成：
    ScalePad-标准版.zip    首页没有“自适应”选项
    ScalePad-自适应版.zip  首页可开启自适应

只打包 git 管理的程序文件；证书、原始问卷（Scales/）、.git 都不会带出去。
"""

from __future__ import annotations

import datetime
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
EXCLUDE_PREFIXES = ("dist/", "Scales/", "Scale/", "certs/", ".git")
EXCLUDE_FILES = {".gitignore", "tools/build_release.py"}
EXECUTABLE = (".command", ".sh")

VERSIONS = [
    ("ScalePad-标准版", "ScalePad-standard", False),
    ("ScalePad-自适应版", "ScalePad-adaptive", True),
]

GUIDE = """ScalePad（{label}）使用说明
打包日期：{date}

【Mac】
1. 解压后双击 start-scalepad-desktop.command。
   第一次如果提示“无法打开”：右键点它 → 打开 → 打开。
2. 会自动用 Chrome 打开 http://127.0.0.1:47815/ ，测试期间不要关掉弹出的终端窗口。

【Windows】
1. 解压后双击 start-scalepad-desktop.bat。
   如果提示“Windows 已保护你的电脑”：点“更多信息”→“仍要运行”。
2. 会自动用默认浏览器打开 http://127.0.0.1:47815/ ，测试期间不要关掉黑色窗口。
   建议用 Chrome 或 Edge。

【没有安装 Python 时】
启动脚本会直接用浏览器打开 index.html，答题、导出 CSV/JSON/xlsx 都正常，
只是没有“追加进汇总表”按钮。想要这个按钮，安装 Python 3（https://www.python.org/downloads/，
Windows 安装时勾选“Add python.exe to PATH”），再执行 pip install openpyxl。

【注意】
- 答题记录保存在这台电脑的浏览器里。每次测完请在结果页导出 CSV 和 JSON 存好；
  清除浏览器数据会删掉本机记录。
- 认知任务（数轴、点数比较）第一次使用请在“更多设置 > 认知任务画面尺寸校准”量一下 10 厘米的线。
- 口答题由医生用键盘 1 / 2 / 3 标记（1 正确、2 错误、3 不确定），也可以点屏幕下方灰色的“医生记录”区。
{adaptive_note}
更详细的说明见 README.md。
"""

ADAPTIVE_NOTE = """- 自适应：首页“自适应”选“开启”后，每部分至少做 5 题，先做约一半难题；难题全对，其余题自动计为正确；
  连续答错 4 题，其余题按 002（太难）自动跳过；不看用时。
"""


def tracked_files() -> list[str]:
    output = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"],
        cwd=ROOT, check=True, capture_output=True,
    ).stdout.decode("utf-8")
    files = [name for name in output.split("\0") if name]
    return sorted(
        name for name in files
        if not name.startswith(EXCLUDE_PREFIXES) and name not in EXCLUDE_FILES and (ROOT / name).is_file()
    )


def write_entry(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=datetime.datetime.now().timetuple()[:6])
    info.compress_type = zipfile.ZIP_DEFLATED
    mode = 0o755 if name.endswith(EXECUTABLE) else 0o644
    info.external_attr = (0o100000 | mode) << 16
    archive.writestr(info, data)


def build(label: str, folder: str, adaptive: bool, files: list[str]) -> Path:
    target = DIST / f"{label}.zip"
    config = (
        "/* 发布配置：adaptive 为 false 时首页不显示“自适应”选项（标准版）。 */\n"
        f"window.scalePadConfig = {{ adaptive: {'true' if adaptive else 'false'} }};\n"
    )
    guide = GUIDE.format(
        label=label.split("-")[-1], date=datetime.date.today().isoformat(),
        adaptive_note=ADAPTIVE_NOTE if adaptive else "",
    )
    with zipfile.ZipFile(target, "w") as archive:
        for name in files:
            data = config.encode("utf-8") if name == "config.js" else (ROOT / name).read_bytes()
            write_entry(archive, f"{folder}/{name}", data)
        # Windows 记事本对带 BOM 的 UTF-8 最稳
        write_entry(archive, f"{folder}/使用说明.txt", ("﻿" + guide.replace("\n", "\r\n")).encode("utf-8"))
    return target


def main() -> None:
    files = tracked_files()
    if "config.js" not in files:
        raise SystemExit("缺少 config.js")
    DIST.mkdir(exist_ok=True)
    for label, folder, adaptive in VERSIONS:
        path = build(label, folder, adaptive, files)
        print(f"{path.relative_to(ROOT)}  ({path.stat().st_size / 1024 / 1024:.1f} MB, {len(files) + 1} 个文件)")


if __name__ == "__main__":
    main()
