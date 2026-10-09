#!/bin/zsh
set -eu

project_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cert_dir="$project_root/certs"
private_cert_dir="${HOME}/Library/Application Support/ScalePad"
config_path="$cert_dir/openssl-scalepad.cnf"

mkdir -p "$cert_dir" "$private_cert_dir"

python_bin="$(command -v python3 || true)"
if [[ -z "$python_bin" ]]; then
  print "找不到 python3。可先执行：brew install python"
  exit 1
fi

# 可用 SCALEPAD_IP=192.168.x.x ./start-scalepad-mac.sh 指定地址（例如临时沿用安装时的旧 IP）
local_ip="${SCALEPAD_IP:-}"
for interface in en0 en1 en2; do
  [[ -n "$local_ip" ]] && break
  candidate="$(/sbin/ipconfig getifaddr "$interface" 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    local_ip="$candidate"
    break
  fi
done
if [[ -z "$local_ip" ]]; then
  local_ip="$(/sbin/ifconfig | /usr/bin/awk '/inet / && $2 != "127.0.0.1" { print $2; exit }')"
fi
if [[ -z "$local_ip" ]]; then
  print "找不到局域网 IPv4 地址，请先连接 Wi-Fi 或网线。"
  exit 1
fi

# 证书只对生成时的 IP 有效，所以按 IP 分开存：IP 没变就复用，变了自动生成新的
cert_name="scalepad-$local_ip.crt"
cert_path="$cert_dir/$cert_name"
key_path="$private_cert_dir/scalepad-$local_ip.key"

openssl_bin="$(command -v openssl || true)"
if [[ -z "$openssl_bin" ]]; then
  print "找不到 openssl，请先安装 OpenSSL。"
  exit 1
fi

if [[ ! -f "$cert_path" || ! -f "$key_path" ]]; then
  cat > "$config_path" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ScalePad local installation $local_ip

[v3_req]
subjectAltName = IP:$local_ip, DNS:localhost
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
EOF

  "$openssl_bin" req -x509 -nodes -newkey rsa:2048 \
    -keyout "$key_path" -out "$cert_path" -days 825 -config "$config_path"
  rm -f "$config_path"
  print "已为新地址 $local_ip 生成证书：$cert_path"
  print "这是新地址：iPad 需要重新下载并信任证书，用新地址安装的是一个新的 App（旧 App 的记录不会带过去）。"
else
  print "复用已有证书：$cert_path"
fi

print "在 iPad Safari 打开：https://$local_ip:8443/"
print "首次安装前，可通过 HTTP 服务下载证书："
print "http://$local_ip:8000/certs/$cert_name"

"$python_bin" -m http.server 8000 --bind 0.0.0.0 --directory "$project_root" >/tmp/scalepad-http.log 2>&1 &
http_pid=$!
trap 'kill "$http_pid" 2>/dev/null || true' EXIT INT TERM
"$python_bin" "$project_root/serve_https.py" --bind 0.0.0.0 --port 8443 --cert "$cert_path" --key "$key_path"
