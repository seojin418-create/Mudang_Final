"""보고서 그림을 만듭니다. 결과는 final_project/figures/에 PNG로 저장합니다.

사용: node scripts/export-route.mjs  →  python scripts/figures.py
"""
import json
import math
import pathlib

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT.parent / 'final_project' / 'figures'
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False

UP, DOWN, ROAD, INK, MUTED = '#1f6f8b', '#c0392b', '#d6d4cc', '#1d1d1b', '#6e6d67'


def route_map():
    geo = json.loads((ROOT / 'results' / 'route-geometry.json').read_text(encoding='utf-8'))
    stops = geo['stops']
    lat0 = sum(s['y'] for s in stops) / len(stops)
    k = math.cos(math.radians(lat0))
    xy = lambda p: (p[0] * k, p[1])
    xs = [xy(c)[0] for leg in geo['legs'] for c in leg['coords']]
    ys = [xy(c)[1] for leg in geo['legs'] for c in leg['coords']]
    pad = 0.0009
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad * 0.7, max(ys) + pad * 0.7

    fig, ax = plt.subplots(figsize=(7.2, 5.4), dpi=220)
    for a, b in geo['roads']:
        (ax_, ay), (bx, by) = xy(a), xy(b)
        if x0 - pad < ax_ < x1 + pad and y0 - pad < ay < y1 + pad:
            ax.plot([ax_, bx], [ay, by], color=ROAD, lw=1.2, solid_capstyle='round', zorder=1)
    # 상행(반도체대학 → AI공학관)과 하행(AI공학관 → 반도체대학)을 색으로 나눕니다.
    # 교육대학원~AI공학관은 상행과 하행이 같은 길을 쓰므로, 진행 방향 오른쪽으로 조금씩 비켜 그려 둘 다 보이게 합니다.
    def shifted(pts, d):
        out = []
        for j, (x, y) in enumerate(pts):
            ax_, ay = pts[max(0, j - 1)]; bx, by = pts[min(len(pts) - 1, j + 1)]
            dx, dy = bx - ax_, by - ay; n = math.hypot(dx, dy) or 1
            out.append((x + dy / n * d, y - dx / n * d))
        return out
    for i, leg in enumerate(geo['legs']):
        color = UP if i < 3 else DOWN
        pts = shifted([xy(c) for c in leg['coords']], 0.000022)
        ax.plot([p[0] for p in pts], [p[1] for p in pts], color=color, lw=3.2, solid_capstyle='round', zorder=2)
        # 구간 가운데에 진행 방향 화살표
        mid = len(pts) // 2
        a, b = pts[max(0, mid - 1)], pts[min(len(pts) - 1, mid + 1)]
        if a != b:
            ax.add_patch(FancyArrowPatch(a, b, arrowstyle='-|>', mutation_scale=13, color=color, lw=0, zorder=3))
    offsets = {'반도체대학': (12, 16), '교육대학원': (10, -4), '학생회관': (10, -2), 'AI공학관': (-12, -4),
               '중앙도서관': (-6, 12), '예체대': (-8, 8), '글로벌센터': (-10, -14)}
    notes = {'반도체대학': '기점 · 30초 탑승 후 출발', 'AI공학관': '기사 휴식 · 5분 간격 출발'}
    for n, s in enumerate(stops, 1):
        x, y = xy((s['x'], s['y']))
        ax.scatter([x], [y], s=70, color='white', edgecolor=INK, linewidth=1.6, zorder=4)
        dx, dy = offsets.get(s['name'], (8, 6))
        label = f"{n} {s['name']}" + (f"\n{notes[s['name']]}" if s['name'] in notes else '')
        ax.annotate(label, (x, y), xytext=(dx, dy), textcoords='offset points', fontsize=9, color=INK,
                    ha='left' if dx >= 0 else 'right', va='center', zorder=5,
                    bbox=dict(boxstyle='round,pad=0.2', fc='white', ec='none', alpha=0.85))
    ax.plot([], [], color=UP, lw=3, label='상행 (반도체대학 → AI공학관)')
    ax.plot([], [], color=DOWN, lw=3, label='하행 (AI공학관 → 반도체대학)')
    ax.legend(loc='lower right', fontsize=8.5, frameon=True, framealpha=0.95)
    # 축척 막대 200m
    meters_per_deg = 111320
    bar = 200 / meters_per_deg
    bx, by = x0 + pad * 0.4, y0 + pad * 0.35
    ax.plot([bx, bx + bar], [by, by], color=INK, lw=2)
    ax.text(bx + bar / 2, by + pad * 0.12, '200m', ha='center', fontsize=8, color=INK)
    ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_aspect('equal')
    ax.set_xticks([]); ax.set_yticks([])
    for side in ax.spines.values():
        side.set_color('#bdbbb3')
    total = sum(l['meters'] for l in geo['legs'])
    ax.text(x0 + pad * 0.4, y1 - pad * 0.3, f'한 바퀴 {total / 1000:.1f}km · 정류장 7곳', fontsize=9, color=MUTED, va='top')
    fig.tight_layout()
    path = OUT / '그림2-1_노선도.png'
    fig.savefig(path)
    plt.close(fig)
    return path




def queue_profile():
    """그림 4-1: 9:30~17:30 매시 분별 평균 대기 인원(시뮬레이션)과 체감 대기."""
    prof = json.loads((ROOT / 'results' / 'queue-profile.json').read_text(encoding='utf-8'))
    felt = {'ST01': [(0, 20, 36), (20, 40, 18), (40, 60, 63)], 'ST04': [(0, 20, 54), (20, 40, 36), (40, 60, 63)]}
    names = {'ST01': '반도체대학 (밖에서 기다리는 학생)', 'ST04': 'AI공학관 (쉬는 차에 탄 학생 포함)'}
    fig, axes = plt.subplots(1, 2, figsize=(7.4, 3.1), dpi=220, sharey=True)
    for ax, stop in zip(axes, ['ST01', 'ST04']):
        for a, b, v in felt[stop]:
            ax.plot([a, b], [v, v], color=DOWN, lw=2.4, solid_capstyle='butt', label='체감' if a == 0 else None)
        ax.plot(prof['minute'], prof[stop], color=UP, lw=1.8, label='시뮬레이션 (현황)')
        ax.set_title(names[stop], fontsize=9.5, color=INK)
        ax.set_xticks([0, 20, 40, 60]); ax.set_xlim(0, 60); ax.set_ylim(0, 80)
        ax.set_xlabel('매시 분', fontsize=8.5, color=MUTED)
        ax.tick_params(labelsize=8, colors=MUTED)
        ax.grid(axis='y', color='#e6e4dd', lw=0.8); ax.set_axisbelow(True)
        for side in ('top', 'right'):
            ax.spines[side].set_visible(False)
    axes[0].set_ylabel('대기 인원 (명)', fontsize=8.5, color=MUTED)
    axes[1].legend(fontsize=8, frameon=False, loc='lower right')
    fig.tight_layout()
    path = OUT / '그림4-1_분별_대기인원.png'
    fig.savefig(path)
    plt.close(fig)
    return path



def scenario_compare():
    """그림 6-1: 시나리오별 정류장 대기와 기사 휴식 (시드 5개 평균, scripts 결과에서 옮겨 적은 값)."""
    names = ['현황', '제안 1', '제안 2', '만차 즉시\n(참고)']
    semi = [11.1, 3.0, 2.9, 2.9]          # 반도체대학 평균 대기(분)
    ai = [13.8, 2.7, 2.4, 2.3]            # AI공학관 도착부터 출발까지(분)
    rest = [23.0, 19.6, 27.4, 19.0]       # 기사당 휴식(분/시)
    longest = [34, 34, 21, 61]            # 5분 이상 쉬지 못한 최장 연속 운행(분)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.4, 3.0), dpi=220)
    x = range(len(names)); w = 0.38
    b1 = a1.bar([i - w / 2 for i in x], semi, w, color=UP, label='반도체대학 대기')
    b2 = a1.bar([i + w / 2 for i in x], ai, w, color='#7fb3c4', label='AI공학관 출발까지')
    for bars in (b1, b2):
        for r in bars:
            a1.text(r.get_x() + r.get_width() / 2, r.get_height() + 0.3, f'{r.get_height():.1f}', ha='center', fontsize=7.5, color=INK)
    a1.set_title('학생: 평균 대기시간 (분)', fontsize=9.5, color=INK)
    a1.legend(fontsize=7.5, frameon=False)
    colors = [MUTED, UP, '#1e7b45', DOWN]
    b3 = a2.bar(list(x), rest, 0.55, color=colors)
    for r, l in zip(b3, longest):
        a2.text(r.get_x() + r.get_width() / 2, r.get_height() + 0.5, f'{r.get_height():.1f}분', ha='center', fontsize=7.5, color=INK)
        a2.text(r.get_x() + r.get_width() / 2, 1.2, f'최장\n{l}분', ha='center', fontsize=7, color='white')
    a2.set_title('기사님: 1명당 시간당 휴식 (분)', fontsize=9.5, color=INK)
    for ax in (a1, a2):
        ax.set_xticks(list(x)); ax.set_xticklabels(names, fontsize=8)
        ax.tick_params(labelsize=8, colors=MUTED)
        ax.grid(axis='y', color='#e6e4dd', lw=0.8); ax.set_axisbelow(True)
        for side in ('top', 'right'):
            ax.spines[side].set_visible(False)
    a2.set_ylim(0, 32)
    fig.tight_layout()
    path = OUT / '그림6-1_시나리오_비교.png'
    fig.savefig(path)
    plt.close(fig)
    return path


if __name__ == '__main__':
    print(route_map())
    print(queue_profile())
    print(scenario_compare())
