"""Put the demo recording into its window mockup, burn in the captions and
encode it as 1080p MP4.

    python3 tests/demo/post.py <dir with raw.webm, frame.png and marks.json>

The approach is the paper repository's video/recorder/post.py: captions are
timestamps in marks.json; stretches marked as waits are sped up (this
recording has none: it calls no model). New here: the recording is placed in
a window frame (frame.png, written by the recorder, transparent where the
recording shows through), with the captions in the band below the window;
the title cards are shown full-screen, without the window.
"""
import json
import os
import subprocess
import sys
import textwrap

out = sys.argv[1] if len(sys.argv) > 1 else "."
os.chdir(out)
m = json.load(open("marks.json"))
W, H = m["W"], m["H"]
VW, VH = m["video"]["width"], m["video"]["height"]
CX, CY = m["content"]["x"], m["content"]["y"]
BACKDROP = m.get("backdrop", "#0f2a2a").replace("#", "0x")
SPEED = 5.0
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
if not os.path.exists(FONT):
    FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

dur = float(subprocess.check_output(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "raw.webm"]
).decode())
end = min(m["end"], dur)

waits = sorted([w for w in m.get("waits", []) if w["e"] - w["s"] > 2.0], key=lambda w: w["s"])
segs, t = [], 0.0
for w in waits:
    if w["s"] > t:
        segs.append((t, w["s"], 1.0))
    segs.append((w["s"], w["e"], SPEED))
    t = w["e"]
segs.append((t, end, 1.0))


def remap(x):
    total = 0.0
    for a, b, speed in segs:
        if x >= b:
            total += (b - a) / speed
        elif x > a:
            total += (x - a) / speed
    return total


parts = [
    f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{speed}[s{i}]"
    for i, (a, b, speed) in enumerate(segs)
]
fc = ";".join(parts) + ";" + "".join(f"[s{i}]" for i in range(len(segs)))
fc += f"concat=n={len(segs)}:v=1:a=0,fps=30,scale={W}:{H}[rec]"
# Backdrop, the recording where the window's content is, the window on top
fc += f";color=c={BACKDROP}:s={VW}x{VH}:r=30[bg]"
fc += f";[bg][rec]overlay={CX}:{CY}:shortest=1[placed]"
fc += ";[placed][1:v]overlay=0:0[framed]"

# Title cards fill the picture: the recording, enlarged and centred, over
# everything while a card is up (its background is the backdrop colour)
cards = m.get("cards", [])
if cards:
    shown = "+".join(f"between(t,{remap(c['s']):.2f},{remap(c['e']):.2f})" for c in cards)
    fc = fc.replace(f"scale={W}:{H}[rec]", f"scale={W}:{H},split[rec][rec2]")
    fc += (
        f";[rec2]scale={VW}:-2,pad={VW}:{VH}:0:(oh-ih)/2:color={BACKDROP}[full]"
        f";[framed][full]overlay=0:0:enable='{shown}'[v0]"
    )
else:
    fc += ";[framed]null[v0]"

# Captions: centred in the band between the window and the bottom edge
band_top = CY + H
band = VH - band_top
caps, chain, n = m["caps"], "[v0]", 0
for i, c in enumerate(caps):
    if not c["text"]:
        continue
    a = remap(c["t"])
    b = remap(caps[i + 1]["t"] if i + 1 < len(caps) else end)
    lines = textwrap.wrap(c["text"], 76)[:2]
    for j, line in enumerate(lines):
        name = f"cap_{i}_{j}.txt"
        open(name, "w").write(line)
        y = band_top + (band - len(lines) * 40) / 2 + j * 40 + 14
        fc += (
            f";{chain}drawtext=fontfile={FONT}:textfile={name}:fontsize=30:fontcolor=white:"
            f"x=(w-text_w)/2:y={y:.0f}:enable='between(t,{a:.2f},{b:.2f})'[c{n}]"
        )
        chain = f"[c{n}]"
        n += 1
fc += f";{chain}format=yuv420p[out]"
open("filter.txt", "w").write(fc)
subprocess.check_call([
    "ffmpeg", "-y", "-v", "error", "-i", "raw.webm", "-loop", "1", "-i", "frame.png",
    "-filter_complex_script", "filter.txt", "-map", "[out]", "-t", f"{remap(end):.2f}",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart",
    "malleable-forms-demo.mp4",
])
for name in os.listdir("."):
    if name.startswith("cap_") or name == "filter.txt":
        os.remove(name)
print(f"malleable-forms-demo.mp4: {remap(end):.0f} s, {len([c for c in caps if c['text']])} captions")
