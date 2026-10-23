"""生成空间题、时钟题的示例图（assets/examples/*.svg）。用法：python3 tools/make_examples.py assets/examples"""
import math, sys, pathlib
out = pathlib.Path(sys.argv[1])
GRAY = '#9fb3c8'

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><rect width="{w}" height="{h}" fill="#fff"/>{body}</svg>\n'

# ---------- 时钟 ----------
def hand(cx, cy, angle, length, width):
    a = math.radians(angle)
    dx, dy = math.sin(a), -math.cos(a)
    tx, ty = cx + dx * length, cy + dy * length
    bx, by = tx - dx * 28, ty - dy * 28          # 箭头底部中心
    px, py = -dy, dx                              # 垂直方向
    head = f'{tx:.1f},{ty:.1f} {bx + px * 15:.1f},{by + py * 15:.1f} {bx - px * 15:.1f},{by - py * 15:.1f}'
    return (f'<line x1="{cx}" y1="{cy}" x2="{bx:.1f}" y2="{by:.1f}" stroke="#000" stroke-width="{width}" stroke-linecap="round"/>'
            f'<polygon points="{head}" fill="#000"/>')

def clock_body(h, m, divider=True):
    cx = cy = 250
    if not divider:
        # 想象中的钟面：不画分界线，淡蓝底色表示“在脑海里”
        body = f'<circle cx="{cx}" cy="{cy}" r="245" fill="#e3eefb"/>'
    else:
        body = f'<line x1="{cx}" y1="22" x2="{cx}" y2="478" stroke="{GRAY}" stroke-width="4" stroke-dasharray="14 12"/>'
    if divider:
        body += f'<text x="40" y="52" font-size="44" fill="#486581" text-anchor="middle" font-family="sans-serif">左</text>'
        body += f'<text x="460" y="52" font-size="44" fill="#486581" text-anchor="middle" font-family="sans-serif">右</text>'
    body += f'<circle cx="{cx}" cy="{cy}" r="225" fill="none" stroke="#000" stroke-width="8"/>'
    for k in range(4):
        a = math.radians(k * 90)
        x1, y1 = cx + 225 * math.sin(a), cy - 225 * math.cos(a)
        x2, y2 = cx + 185 * math.sin(a), cy - 185 * math.cos(a)
        body += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#000" stroke-width="8"/>'
    body += hand(cx, cy, (h % 12 + m / 60) * 30, 120, 12)
    body += hand(cx, cy, m * 6, 175, 9)
    body += f'<circle cx="{cx}" cy="{cy}" r="9" fill="#000"/>'
    return body

def clock(h, m, divider=True):
    return svg(500, 500, clock_body(h, m, divider))

def timed_clock(label, h, m):
    # 想象时钟示例：上面是屏幕上出现的时间，下面是在脑海里想出的钟面
    text = f'<text x="250" y="110" font-size="110" font-weight="700" fill="#000" text-anchor="middle" font-family="sans-serif">{label}</text>'
    return svg(500, 650, text + f'<g transform="translate(0,150)">{clock_body(h, m)}</g>')

for name, (h, m) in {'clock-right': (1, 10), 'clock-left': (10, 45), 'clock-split': (2, 35)}.items():
    (out / f'{name}.svg').write_text(clock(h, m))

# 时钟想象题的流程示例：看到 15:05 → 想出钟面 → 判断
(out / 'clock-time.svg').write_text(svg(500, 500, '<text x="250" y="290" font-size="150" font-weight="700" fill="#000" text-anchor="middle" font-family="sans-serif">15:05</text>'))
(out / 'clock-imagine.svg').write_text(clock(3, 5, divider=False))
(out / 'clock-305.svg').write_text(clock(3, 5))
for name, (label, h, m) in {'clock-imagery-left': ('21:50', 9, 50), 'clock-imagery-right': ('15:05', 3, 5), 'clock-imagery-split': ('19:25', 7, 25)}.items():
    (out / f'{name}.svg').write_text(timed_clock(label, h, m))

# ---------- 空间 ----------
DOTS = [(130, 110), (470, 90), (90, 300), (430, 330)]

def dots(ghost=False):
    if ghost:
        # 刚才出现过的点：浅灰实心点 + 虚线圈，比黑点淡，一眼能看出“原来在这里”
        return ''.join(f'<circle cx="{x}" cy="{y}" r="11" fill="#bcccdc"/><circle cx="{x}" cy="{y}" r="20" fill="none" stroke="#829ab1" stroke-width="3" stroke-dasharray="7 5"/>' for x, y in DOTS)
    return ''.join(f'<circle cx="{x}" cy="{y}" r="11" fill="#000"/>' for x, y in DOTS)

def arrow(sx, sy, dx, dy, extend_to=None):
    n = math.hypot(dx, dy); dx, dy = dx / n, dy / n
    tx, ty = sx + dx * 80, sy + dy * 80
    bx, by = tx - dx * 22, ty - dy * 22
    px, py = -dy, dx
    body = ''
    if extend_to:
        ex, ey = extend_to
        body += f'<line x1="{tx:.1f}" y1="{ty:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#d64545" stroke-width="3" stroke-dasharray="10 8"/>'
    body += f'<line x1="{sx}" y1="{sy}" x2="{bx:.1f}" y2="{by:.1f}" stroke="#000" stroke-width="7"/>'
    body += f'<polygon points="{tx:.1f},{ty:.1f} {bx + px * 13:.1f},{by + py * 13:.1f} {bx - px * 13:.1f},{by - py * 13:.1f}" fill="#000"/>'
    return body

YES_START, YES_TARGET = (330, 235), DOTS[0]
yes_dir = (YES_TARGET[0] - YES_START[0], YES_TARGET[1] - YES_START[1])
NO_START, NO_DIR = (270, 260), (0.18, -1)
no_end = (NO_START[0] + NO_DIR[0] * 250, NO_START[1] + NO_DIR[1] * 250)

W, H = 600, 420
(out / 'spatial-yes.svg').write_text(svg(W, H, dots() + arrow(*YES_START, *yes_dir, extend_to=YES_TARGET)))
(out / 'spatial-no.svg').write_text(svg(W, H, dots() + arrow(*NO_START, *NO_DIR, extend_to=no_end)))
(out / 'sequence-1.svg').write_text(svg(W, H, dots()))
(out / 'sequence-2.svg').write_text(svg(W, H, arrow(*YES_START, *yes_dir)))
(out / 'sequence-3.svg').write_text(svg(W, H, dots(ghost=True) + arrow(*YES_START, *yes_dir, extend_to=YES_TARGET)))
(out / 'sequence-no.svg').write_text(svg(W, H, dots(ghost=True) + arrow(*NO_START, *NO_DIR, extend_to=no_end)))
print(sorted(p.name for p in out.iterdir()))
