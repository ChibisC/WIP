#!/bin/bash
# usage: tools/strip.sh "<base query>" out.png "<param>" "v1 v2 v3 v4" [w h]
base="$1"; out="$2"; param="$3"; vals=($4); w=${5:-640}; h=${6:-360}
i=0
for v in "${vals[@]}"; do
  python3 tools/shot.py "$base&$param=$v" /tmp/claude-0/st_$i.png $w $h 120 100 >/dev/null 2>&1 &
  i=$((i+1))
done
wait
python3 -c "
from PIL import Image, ImageDraw
n=$i
ims=[Image.open(f'/tmp/claude-0/st_{k}.png') for k in range(n)]
w,h=ims[0].size
cols=min(n,3); rows=(n+cols-1)//cols
W=Image.new('RGB',(w*cols,h*rows))
vals='${vals[*]}'.split()
for k,im in enumerate(ims):
  d=ImageDraw.Draw(im); d.text((8,8),'$param='+vals[k],fill=(255,255,255))
  W.paste(im,((k%cols)*w,(k//cols)*h))
W.save('$out')
"
