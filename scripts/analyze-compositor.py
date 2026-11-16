"""Track the same source/card labels in actual compositor PNG frames."""
import json
import math
import sys
from pathlib import Path

import cv2

directory = Path(sys.argv[1])
geometry = json.loads((directory / "geometry.json").read_text(encoding="utf8"))
frames = [cv2.imread(str(directory / f"{row['index']:04d}.png"), cv2.IMREAD_GRAYSCALE) for row in geometry["frames"]]
assert frames
templates = {}
for name in ["body", "card"]:
    box = geometry[name]
    x, y = math.floor(box["x"]), math.floor(box["y"])
    w, h = math.ceil(box["width"]), math.ceil(box["height"])
    templates[name] = (x, y, w, frames[0][y:y + h, x:x + w])
rows = []
for i, frame in enumerate(frames):
    row = {"frame": i, "timestamp": geometry["frames"][i]["timestamp"]}
    for name, (x, y, w, template) in templates.items():
        matches = cv2.matchTemplate(frame[:, x:x + w], template, cv2.TM_CCOEFF_NORMED)
        _, score, _, location = cv2.minMaxLoc(matches)
        row[name] = location[1] - y
        row[name + "Confidence"] = round(score, 4)
    row["drift"] = row["card"] - row["body"]
    rows.append(row)
valid = [row for row in rows if min(row["bodyConfidence"], row["cardConfidence"]) >= .8]
report = {"method": "fixed-x normalized cross correlation of source/card labels in compositor frames",
          "frames": rows, "validFrames": len(valid), "capturedFrames": len(rows),
          "maxDriftPixels": max(abs(row["drift"]) for row in valid),
          "over1Pixel": sum(abs(row["drift"]) > 1 for row in valid), "dpr": geometry["dpr"]}
(directory / "analysis.json").write_text(json.dumps(report, indent=2), encoding="utf8")
print(json.dumps({k: v for k, v in report.items() if k != "frames"}))
