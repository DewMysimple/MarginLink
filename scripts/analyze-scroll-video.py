"""Decode every source-video frame and measure independent body/decoration motion.

Usage: python scripts/analyze-scroll-video.py INPUT OUTPUT.json
Requires OpenCV. Coordinates below refer to the supplied 1134x898 recording.
"""
import json
import sys
from pathlib import Path

import cv2

capture = cv2.VideoCapture(sys.argv[1])
fps = capture.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, frame = capture.read()
    if not ok:
        break
    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
capture.release()
assert frames and frames[0].shape == (898, 1134)
# Short unique lines remain visible over the entire recorded scroll range.
regions = {
    "body": (216, 242, 885, 258),
    "card": (122, 310, 192, 325),
    "number": (148, 239, 168, 255),
    "corner": (958, 225, 976, 239),
}
rows = [{"frame": i, "seconds": round(i / fps, 6)} for i in range(len(frames))]
for name, (left, top, right, bottom) in regions.items():
    template = frames[0][top:bottom, left:right]
    for row, frame in zip(rows, frames):
        match = cv2.matchTemplate(frame[:, left:right], template, cv2.TM_CCOEFF_NORMED)
        _, confidence, _, location = cv2.minMaxLoc(match)
        row[name] = location[1] - top
        row[name + "Confidence"] = round(confidence, 4)
for row in rows:
    row["drift"] = row["card"] - row["body"]
active = sorted(abs(row["drift"]) for row in rows[22:106])
report = {"width": 1134, "height": 898, "fps": fps, "decodedFrames": len(frames),
          "method": "fixed-x grayscale normalized cross correlation, independent templates",
          "regions": regions, "activeFrames": [22, 105],
          "over1px": sum(value > 1 for value in active), "over100px": sum(value > 100 for value in active),
          "medianAbsoluteDrift": (active[41] + active[42]) / 2, "maxAbsoluteDrift": max(active), "frames": rows}
Path(sys.argv[2]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({key: value for key, value in report.items() if key != "frames"}, ensure_ascii=False))
