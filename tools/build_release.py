"""打包发给别人用的两版 ScalePad（Windows / Mac 通用）：

    python3 tools/build_release.py

在 dist/ 下生成（都是电脑版，Mac / Windows 通用）：
    ScalePad-电脑版.zip                    对外版：自适应相关的代码、文字、导出列全部剥掉，看不出有这个功能
    ScalePad-电脑版-内部（含自适应）.zip   首页可开启自适应

只打包 git 管理的程序文件；证书、原始问卷（Scales/）、.git、iPad 专用文件都不会带出去。

源码里自适应相关的地方用标记圈出来，打包时处理：
    //@A{ … //@A}（HTML 里 <!--@A{--> … <!--@A}-->）  整段只在内部版保留
    行尾 /*@A*/                                        这一行只在内部版保留
    //@E 代码                                          对外版用这一行替换上面那行（内部版删掉）
    <!--@A-->文字<!--@A-->                             行内一段只在内部版保留
"""

from __future__ import annotations

import datetime
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
EXCLUDE_PREFIXES = ("dist/", "Scales/", "Scale/", "certs/", ".git")
EXCLUDE_FILES = {
    ".gitignore", "tools/build_release.py", "tools/make_examples.py", "check-assets.js",
    # iPad 版暂停更新，电脑版不需要这些
    "在iPad上安装.md", "serve_https.py", "start-scalepad-mac.sh", "start-scalepad.ps1", "allow-scalepad-firewall.ps1",
}
EXECUTABLE = (".command", ".sh")

VERSIONS = [
    ("ScalePad-电脑版", "ScalePad", False),
    ("ScalePad-电脑版-内部（含自适应）", "ScalePad-adaptive", True),
]
# 对外版不带 README.md（里面有自适应说明），只带 README-FIRST.txt
INTERNAL_ONLY_FILES = {"README.md"}
STRIP_SUFFIXES = (".js", ".html", ".css")
BLOCK_OPEN = {"//@A{", "<!--@A{-->", "/*@A{*/"}
BLOCK_CLOSE = {"//@A}", "<!--@A}-->", "/*@A}*/"}
LINE_MARK = re.compile(r"\s*(/\*@A\*/|<!--@A-->)\s*$")
SPAN = re.compile(r"<!--@A-->(.*?)<!--@A-->")
EXTERNAL_LINE = re.compile(r"^(\s*)//@E (.*)$")


def strip_markers(text: str, adaptive: bool) -> str:
    """按标记生成内部版 / 对外版的源码（见文件开头说明）"""
    out = []
    depth = 0
    for line in text.split("\n"):
        mark = line.strip()
        if mark in BLOCK_OPEN:
            depth += 1
            continue
        if mark in BLOCK_CLOSE:
            depth -= 1
            continue
        if depth and not adaptive:
            continue
        external = EXTERNAL_LINE.match(line)
        if external:
            if not adaptive:
                out.append(external.group(1) + external.group(2))
            continue
        line = SPAN.sub(r"\1" if adaptive else "", line)
        if LINE_MARK.search(line):
            if not adaptive:
                continue
            line = LINE_MARK.sub("", line)
        out.append(line)
    if depth:
        raise SystemExit("自适应标记 //@A{ 和 //@A} 没有配对")
    return "\n".join(out)
GUIDE_NAME = "README-FIRST.txt"  # 包内文件名用英文：旧版 Windows 解压中文文件名可能乱码

GUIDE = """ScalePad {label} 使用说明
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

【怎么选题】
首页上面选“BIP A 套”或“BIP B 套”（先感知、再想象，一般选这个）。
特殊情况点“分开做”，只做感知或只做想象。下面可以再加 VVIQ、PIT、情绪量表等。
每套先朗读数字、字母、词语，再做医生读题和医生判断的部分，之后屏幕提示把设备交给患者。
空间题、时钟题开始前先显示一页示例（不计分），至少看 5 秒才能点“看懂了，开始答题”。
名人题全部做完；患者没见过的名人不计入正确率。

【注意】
- 答题记录保存在这台电脑的浏览器里。每次测完请在结果页导出 CSV 和 JSON 存好；
  清除浏览器数据会删掉本机记录。
- 认知任务（数轴、点数比较）第一次使用请在“更多设置 > 认知任务画面尺寸校准”量一下 10 厘米的线。
- 口答题由医生用键盘 1 / 2 / 3 标记（1 正确、2 错误、3 不确定），也可以点屏幕下方灰色的“医生记录”区。
  名人面孔识别：1 正确、2 错误、3 没见过；名人比较题（谁的脸更圆等）：3 = 有人没见过。
- 电脑键盘：A 上一题、D 下一题（← → 也行）、W 上一部分、S 下一部分，按一下即可。
  跳过要长按 Q 或空格，再按 1–6 选代码（屏幕上只显示代码，患者看不出原因）：
  1 = 001 过于简单  2 = 002 太难  3 = 003 不熟悉内容  4 = 004 拒绝或疲劳  5 = 005 设备问题  6 = 009 其他
- 数轴、点数比较评估：右下角“长按跳过”按住 1 秒可跳过；开始后的说明页按 A / Esc 或点“返回”可退回。
{adaptive_note}
{more}
"""

ADAPTIVE_NOTE = """- 自适应：首页“自适应”选“开启”后，每部分先做难题；连续答对 5 题，其余题自动计为正确；
  至少做满 5 题后连续答错 4 题，其余题按 002（太难）自动跳过；不看用时。名人题不省略。
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
        "/* 发布配置 */\nwindow.scalePadConfig = { adaptive: true };\n" if adaptive
        else "/* 发布配置 */\nwindow.scalePadConfig = {};\n"
    )
    guide = GUIDE.format(
        label=label.split("-", 1)[-1] if "-" in label else label, date=datetime.date.today().isoformat(),
        adaptive_note=ADAPTIVE_NOTE if adaptive else "",
        more="更详细的说明见 README.md。" if adaptive else "",
    )
    with zipfile.ZipFile(target, "w") as archive:
        for name in files:
            if name in INTERNAL_ONLY_FILES and not adaptive:
                continue
            if name == "config.js":
                data = config.encode("utf-8")
            elif name.endswith(STRIP_SUFFIXES):
                data = strip_markers((ROOT / name).read_text("utf-8"), adaptive).encode("utf-8")
            else:
                data = (ROOT / name).read_bytes()
            write_entry(archive, f"{folder}/{name}", data)
        # Windows 记事本对带 BOM 的 UTF-8 最稳
        write_entry(archive, f"{folder}/{GUIDE_NAME}", ("﻿" + guide.replace("\n", "\r\n")).encode("utf-8"))
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
