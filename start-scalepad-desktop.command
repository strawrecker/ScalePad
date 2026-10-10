#!/bin/zsh
# 双击运行：在这台电脑上打开 ScalePad。只用本机地址 127.0.0.1，断网也能用，不需要 IP、证书或 Wi-Fi
set -eu
cd "$(dirname "$0")"

pause_and_exit() { read -k 1 "?按任意键关闭…"; exit 1; }

python_bin="$(command -v python3 || true)"
if [[ -z "$python_bin" ]]; then
  print "找不到 python3。可先执行：brew install python"
  pause_and_exit
fi
if ! "$python_bin" -c "import openpyxl" 2>/dev/null; then
  print "提示：缺少 openpyxl，答题不受影响，但不能一键追加进汇总表。安装：pip3 install openpyxl"
fi

# 端口固定：换端口等于换了一个网站，之前的本机记录就看不到了。选一个不常用的，避免和别的程序冲突
port=47815
url="http://127.0.0.1:$port/"

open_browser() {
  # 优先用 Chrome：支持绑定文件夹和系统保存面板
  if [[ -d "/Applications/Google Chrome.app" ]]; then open -a "Google Chrome" "$url"; else open "$url"; fi
}
is_scalepad() { curl -s --max-time 2 "${url}api/desktop" 2>/dev/null | grep -q '"dest"'; }

if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
  if is_scalepad; then
    print "ScalePad 已经在运行，直接打开浏览器。"
    open_browser
    exit 0
  fi
  print "端口 $port 被别的程序占用了："
  lsof -nP -iTCP:$port -sTCP:LISTEN
  print "请先关掉那个程序再双击本脚本。（不要改端口，否则之前的记录会看不到）"
  pause_and_exit
fi

"$python_bin" serve_local.py --port "$port" --no-browser &
server_pid=$!
trap 'kill $server_pid 2>/dev/null' EXIT INT TERM
for _ in {1..50}; do
  is_scalepad && break
  sleep 0.1
done
if ! is_scalepad; then
  print "ScalePad 服务没能启动，请把上面的报错发给维护的人。"
  pause_and_exit
fi
open_browser
wait $server_pid
