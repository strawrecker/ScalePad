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
# 对外版不带 README.md（里面有自适应说明），只带 README.txt
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
GUIDE_NAME = "README.txt"  # 包内文件名用英文：旧版 Windows 解压中文文件名可能乱码

GUIDE = """ScalePad {label} 简易说明（{date}）

一、怎么打开
  Mac：双击 start-scalepad-desktop.command
       （第一次提示“无法打开”：右键点它 → 打开 → 打开）
  Windows：双击 start-scalepad-desktop.bat
       （提示“Windows 已保护你的电脑”：点“更多信息” → “仍要运行”）
  测试期间不要关掉弹出的黑色 / 终端窗口。建议用 Chrome 或 Edge。

二、键盘翻题（按一下就行）
  A = 上一题        D = 下一题        （← → 也可以）
  W = 上一部分      S = 下一部分
  示例页：看满 5 秒后按 Enter 或 D 开始答题

三、医生标记对错（按一下就行）
  1 = 对
  2 = 错
  3 = 不确定（不算进正确率）
  名人面孔识别（看照片说名字）：
      1 = 对    2 = 错（见过但说不出名字）    3 = 没见过（不算进正确率）
  名人比较题（谁的脸更圆等）：
      3 = 有人不认识（不算进正确率），患者也可以自己点“有人不认识”
  字母阅读：大写、小写分成两个部分，分别标记
  选择题：患者自己点的灰色小按钮“不确定” = 算错（和医生标记的 3 不一样）

四、跳过（要长按，防止误触）
  长按 Q = 001 过于简单，直接跳过本题
  长按 E = 002 太难，直接跳过本题
  长按空格 → 弹出跳过菜单 → 按数字选其他代码（Esc 取消），可以写备注
  屏幕上只显示代码，患者看不出原因：
      按 1 = 001  过于简单
      按 2 = 002  太难，做不出来
      按 3 = 003  不熟悉内容（不认识名人、不熟悉英文字母等）
      按 4 = 004  拒绝作答或疲劳
      按 5 = 005  设备或操作问题
      按 6 = 009  其他原因
  菜单里还可以选“仅本题”或“本部分剩余题”。

五、数轴评估、点数比较评估
  长按 Q 1 秒 = 001，长按 E 1 秒 = 002；
  右下角“长按跳过”或长按空格 1 秒 = 跳过本评估，然后选跳过代码
  评估中不显示分数，分数在结果页
  点“开始”后的说明页：按 A / Esc 或点“返回”可以退回
  第一次用请在“更多设置 > 认知任务画面尺寸校准”量一下 10 厘米的线

六、结果页和导出
  做完后屏幕显示“评估结束，请把设备还给医生”，医生长按下面的灰色按钮才显示结果。
  在结果页点“导出结果表（CSV）”和“导出完整备份（JSON）”存好。
  记录只存在这台电脑的浏览器里，清除浏览器数据会删掉。
{adaptive_note}{more}
"""

ADAPTIVE_NOTE = """
七、自适应（仅内部版）
  首页“自适应”选“开启”后，每部分先做难题；连续答对 5 题，其余题自动计为正确；
  至少做满 5 题后连续答错 4 题，其余题按 002 自动跳过。名人题不省略。
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
        more="\n更详细的说明见 README.md。" if adaptive else "",
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
