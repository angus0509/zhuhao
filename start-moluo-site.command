#!/bin/zsh
cd "$(dirname "$0")" || exit 1

PORT=8080
IP="$(ipconfig getifaddr en0 2>/dev/null)"

if [ -z "$IP" ]; then
  IP="$(ifconfig en0 2>/dev/null | awk '/inet / {print $2; exit}')"
fi

if [ -z "$IP" ]; then
  IP="127.0.0.1"
fi

echo ""
echo "莫罗女装 H5 已启动"
echo "电脑访问: http://127.0.0.1:${PORT}"
echo "手机访问: http://${IP}:${PORT}"
echo ""
echo "手机和电脑需要连接同一个 Wi-Fi。"
echo "保持这个窗口打开，网站才会持续可访问。"
echo "按 Control + C 可以关闭网站服务。"
echo ""

python3 -m http.server "$PORT" --bind 0.0.0.0
