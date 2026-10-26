#!/bin/bash
# usage: tools/multi.sh "<base query>" out.png  — renders side/top/front/34 views into a 2x2 grid
base="$1"; out="$2"; w=${3:-800}; h=${4:-450}
i=0
for cam in side top front 34; do
  python3 tools/shot.py "$base&cam=$cam" /tmp/claude-0/mv_$i.png $w $h 120 100 >/dev/null 2>&1 &
  i=$((i+1))
done
wait
python3 -c "
from PIL import Image
ims=[Image.open(f'/tmp/claude-0/mv_{i}.png') for i in range(4)]
w,h=ims[0].size
W=Image.new('RGB',(w*2,h*2))
for i,im in enumerate(ims): W.paste(im,((i%2)*w,(i//2)*h))
W.save('$out')
"
