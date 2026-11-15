"""Deck figures built from the published viewer frames (web/data), so slides show exactly what the site shows."""
import json, sys
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
BG = "#050510"; TXT = "#f0f4ff"; MUT = "#8b8da3"; PRED = "#ff5d73"
def frame(k, f, crop=16):
    a = np.asarray(Image.open(f"web/data/{k}/{f}").convert("RGBA")).astype(float) / 255
    n = a.shape[0]; c = n // 2
    return a[c - crop:c + crop + 1, c - crop:c + crop + 1], c - crop
def triptych(k, band, out, crop=14):
    m = json.load(open(f"web/data/{k}/manifest.json")); full = [p for p in m["passes"] if p["full"]]; a, b = full[0], full[-1]
    fig, ax = plt.subplots(1, 3, figsize=(10.5, 3.9), facecolor=BG)
    for i, (f, title, p) in enumerate([(a["frames"][band], a["date"][:7], a), (b["frames"][band], b["date"][:7], b), (b["diff_frames"][band], "difference", None)]):
        img, off = frame(k, f, crop); n = json.load(open(f"web/data/{k}/manifest.json"))["grid"]["n"]
        ax[i].imshow(img, origin="upper", interpolation="nearest"); ax[i].set_facecolor("#11121b")
        ax[i].set_title(title, color=TXT if p else PRED, fontsize=15, family="DejaVu Sans")
        for q, col in ([(a, "#22d3ee"), (b, PRED)] if p is None else [(p, PRED)]):
            x, y = q["predicted_px"]; ax[i].plot(x - off, (n - 1 - y) - off, "+", color=col, ms=22, mew=1.6)
        ax[i].set_xticks([]); ax[i].set_yticks([])
        for s in ax[i].spines.values(): s.set_color("#2a2d3d")
    plt.tight_layout(); plt.savefig(out, dpi=160, facecolor=BG); plt.close()
def tile(k, band, kind, out, crop=12):
    m = json.load(open(f"web/data/{k}/manifest.json")); full = [p for p in m["passes"] if p["full"]]
    f = full[-1]["diff_frames"][band] if kind == "diff" else full[-1]["frames"][band]
    img, off = frame(k, f, crop)
    fig = plt.figure(figsize=(3, 3), facecolor=BG); ax = fig.add_axes([0, 0, 1, 1]); ax.imshow(img, origin="upper", interpolation="nearest"); ax.axis("off")
    plt.savefig(out, dpi=120, facecolor=BG); plt.close()
if __name__ == "__main__":
    triptych("barnard", "ALL", "deck/shot_diff.png")
    for k, band, kind in [("barnard", "ALL", "diff"), ("epsindb", "D2", "diff"), ("wise0855", "D6", "diff"), ("rwaur", "ALL", "diff"), ("rdra", "ALL", "diff")]:
        try: tile(k, band, kind, f"deck/tile_{k}.png")
        except Exception as e: print("skip", k, e)
    print("figs done")
