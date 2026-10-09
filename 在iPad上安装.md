# 在 iPad 上安装 ScalePad

ScalePad 是本地 PWA。首次安装或更新时 iPad 和电脑需要在同一个 Wi-Fi，完成缓存后可以断开网络使用。功能和数据说明见 [README.md](README.md)。

> **先读这一条：App 的身份 = 安装时的网址（含 IP）。**
> 用 `https://192.168.71.22:8443/` 装的 App 和用 `https://192.168.2.5:8443/` 装的 App 在 iPad 看来是两个不同的 App，本机测试记录互不相通。
> 所以：**更新时尽量让电脑保持安装时的 IP**；必须换地址重新安装时，先在旧 App 里把需要的测试导出。

## 在 Mac 上启动

1. 将整个 `ScalePad` 文件夹复制到 Mac。
2. 如果 Mac 没有 `python3`，在“终端”执行 `brew install python`（需要先安装 Homebrew）。
3. 在终端进入项目文件夹并启动：

   ```zsh
   chmod +x ./start-scalepad-mac.sh
   ./start-scalepad-mac.sh
   ```

4. 脚本会显示当前 Mac 的局域网地址。后续证书安装和“添加到主屏幕”步骤与下面相同。

如果 macOS 防火墙询问是否允许 Python 接收传入连接，请选择“允许”。安装完成并确认离线可用后，可以关闭终端窗口。

如果 iPad 无法打开地址，请在 Windows 设置中将当前 WLAN 网络类型改为“专用”，然后用“管理员身份”打开 PowerShell，在项目文件夹运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\allow-scalepad-firewall.ps1
```

## 首次安装

### Windows

1. 在电脑的 ScalePad 文件夹中打开 PowerShell，先启动普通 HTTP 服务：

   ```powershell
   python -m http.server 8000 --bind 0.0.0.0
   ```

2. 再打开一个 PowerShell 窗口，运行 HTTPS 启动脚本：

   ```powershell
   .\start-scalepad.ps1
   ```

   如果 PowerShell 阻止脚本运行，可改用：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start-scalepad.ps1
   ```

3. 在 iPad Safari 打开脚本显示的证书地址，例如 `http://192.168.1.20:8000/certs/scalepad.crt`（Mac 脚本显示的是 `scalepad-<IP>.crt`），下载并安装证书。

4. 到“设置 > 通用 > VPN 与设备管理”安装刚下载的证书，再到“设置 > 通用 > 关于本机 > 证书信任设置”开启对 `ScalePad local installation`（Mac 生成的证书名称后面带 IP）的完全信任。

5. 在 Safari 打开脚本显示的 HTTPS 地址，例如 `https://192.168.1.20:8443/`。等待页面完整显示后，点“分享 > 添加到主屏幕”。

6. 第一次打开主屏幕图标时保持 Wi-Fi 连接约 30 秒，让问卷和图片完成缓存。然后可开启飞行模式再次打开，确认离线可用。

### macOS

Mac 用户运行 `./start-scalepad-mac.sh` 后，直接使用脚本显示的证书地址和 HTTPS 地址完成上面的第 3–6 步即可。脚本会同时启动两个服务。

## 更新已安装的 App

代码有新版本时（以「更多设置」底部的版本号区分）：

1. 电脑和 iPad 连接**安装时用的同一个 Wi-Fi**，电脑上运行启动脚本。
2. 确认脚本显示的地址和 iPad 当初安装时的地址一致（IP 相同）。不一致见下一节。
3. 从 iPad 主屏幕打开「BIP评估」，联网停留约 30 秒。
4. 从屏幕底部上滑，把 App 完全划掉，再重新打开。
5. 打开「更多设置」，确认版本号已变成新版本；没变就再划掉重开一次。
6. 完成后可以关闭电脑上的服务。

不需要重新安装证书，也不需要重新“添加到主屏幕”。更新不会影响 iPad 上已保存的测试记录。

## 电脑的 IP 变了怎么办

证书只对生成时的 IP 有效。Mac 启动脚本按 IP 分开保存证书（`certs/scalepad-<IP>.crt`）：IP 没变就复用，变了会自动生成新证书并提示。IP 变了以后有两种做法：

**做法一：让电脑临时使用原来的 IP（保留旧 App 和它的记录）**

只在电脑和 iPad 仍在原来那个网络（同一网段）时可用。以原地址 `192.168.71.22` 为例，Mac 终端执行：

```zsh
ping -c 2 192.168.71.22                               # 先确认没有别的设备在用这个地址（应当不通）
sudo ifconfig en0 alias 192.168.71.22 255.255.255.0   # 临时加上旧地址
SCALEPAD_IP=192.168.71.22 ./start-scalepad-mac.sh     # 用旧地址和旧证书启动，iPad 按上一节更新
sudo ifconfig en0 -alias 192.168.71.22                # 更新完删掉（重启电脑也会自动失效）
```

**做法二：用新地址重新安装（得到一个新的空 App）**

1. 先在旧 App 里把需要的测试导出（「最近测试 > 查看结果 > 导出」）。
2. 直接运行启动脚本，它会为新 IP 生成证书。
3. 在 iPad 上按「首次安装」第 3–6 步重新下载、信任证书并添加到主屏幕。
4. 确认新 App 可用后，可以删除旧的主屏幕图标（会同时删掉旧 App 里的记录）。

Windows 的 `start-scalepad.ps1` 仍使用固定的 `certs/scalepad.crt`：IP 变了需要删除它和 `C:\Users\<用户名>\AppData\Local\ScalePad\scalepad.key` 后重新运行脚本。

## 日常使用

以后直接从 iPad 主屏幕打开“BIP评估”即可，不需要电脑开机，也不需要局域网。

- 答题中回首页要**长按左上角房子按钮约 1.5 秒**，防止患者误触。
- 回首页、退出 App 都不会丢失测试；首页顶部「最近测试」里可以「继续作答」或「查看结果」。
- 结果页点「开始下一位患者」直接回到空白首页，不需要退出 App。
开始测试前，系统会先检查本机持久化存储；每次选择会立即写入 IndexedDB，支持 OPFS 的浏览器还会同时写入 ScalePad 专用离线目录。记录包含年龄、每题反应时间、答题耗时、修改次数和题干播放次数。

在 iPad Safari 中，网页不能在没有用户确认的情况下直接指定“文件”App 的下载目录。因此完成测试后请点击“导出 JSON”或“导出 CSV”，在系统文件面板中选择“下载”或其他自定义位置；导出文件中包含完整事件日志。若浏览器支持文件夹权限，也可以在开始答题前选择并验证自定义文件夹，系统会逐题写入该文件夹。

如果电脑更换了局域网 IP，见上面的「电脑的 IP 变了怎么办」。
