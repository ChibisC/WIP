# Team sites (CHANGE_PLAN §23)

Made by `npx vite-node tools/team-sites.ts` from the maps and `world/teamSites.ts`. Routes are land routes on the map's hex layout between site entrances (water and walls go round). Limits: an ally within **33 %** of the map's width, every enemy at least **30 %** away, no enemy site between two allies. Fairness: each team's mean route to the nearest food zone, to the map's middle and to its nearest enemy (the spread between teams is what the search keeps small); in an uneven match the smaller side gets the nearer food. "authored" = the map file's `teamSets`, "search" = picked by the search. Sketches with the teams in colour: `docs/maps/team-sites/`.

## Meadow Pond (1600 × 1600 mm; ally ≤ 528 mm, enemy ≥ 480 mm)

| shape | sites by team | ally route (mm) | nearest enemy (mm) | food by team (mm) | middle by team (mm) | limits | source |
|---|---|---|---|---|---|---|---|
| 2v2 | 2 + 7 v 3 + 6 | 333/333 · 333/333 | 1053/1039 · 1039/1053 | 215 · 208 | 852 · 402 | ok | authored |
| 2v1 (you + an AI ally v one AI) | 2 + 7 v 1 | 333/333 · — | 998/693 · 693 | 215 · 208 | 852 · 873 | ok | authored |
| 3v1 | 2 + 4 + 7 v 1 | 333/333/333 · — | 998/665/693 · 665 | 231 · 208 | 975 · 873 | ok | authored |
| 2v2v2 | 1 + 3 v 2 + 7 v 5 + 8 | 665/665 · 333/333 · 263/263 | 693/624 · 804/693 · 665/624 | 242 · 215 · 242 | 714 · 852 · 312 | colony 0: ally 665 mm away (limit 528); colony 1: ally 665 mm away (limit 528) | authored |
| 2v1v1 (you + an AI ally v two AIs on their own) | 2 + 7 v 0 v 1 | 333/333 · — · — | 665/693 · 665 · 693 | 215 · 208 · 208 | 852 · 554 · 873 | ok | authored |
| 2v1v1v1 | 2 + 7 v 0 v 1 v 3 | 333/333 · — · — · — | 665/693 · 665 · 665 · 665 | 215 · 208 · 208 · 277 | 852 · 554 · 873 · 554 | ok | search |
| 3v3 | 2 + 7 + 9 v 3 + 5 + 6 | 333/291/291 · 333/333/333 | 1025/1039/790 · 790/1025/887 | 212 · 231 | 901 · 416 | ok | authored |

## Forest Floor (1600 × 1600 mm; ally ≤ 528 mm, enemy ≥ 480 mm)

| shape | sites by team | ally route (mm) | nearest enemy (mm) | food by team (mm) | middle by team (mm) | limits | source |
|---|---|---|---|---|---|---|---|
| 2v2 | 2 + 5 v 3 + 4 | 222/222 · 236/236 | 1455/1469 · 1469/1455 | 291 · 277 | 783 · 776 | ok | authored |
| 2v1 (you + an AI ally v one AI) | 2 + 5 v 4 | 222/222 · — | 1455/1593 · 1455 | 291 · 222 | 783 · 790 | ok | authored |
| 3v1 | 2 + 5 + 6 v 0 | 222/222/416 · — | 1081/1289/1025 · 1025 | 222 · 236 | 651 · 637 | ok | authored |
| 2v2v2 | 0 + 9 v 2 + 5 v 3 + 4 | 471/471 · 222/222 · 236/236 | 513/651 · 651/859 · 748/513 | 145 · 291 · 277 | 513 · 783 · 776 | ok | authored |
| 2v1v1 (you + an AI ally v two AIs on their own) | 3 + 4 v 0 v 1 | 236/236 · — · — | 748/513 · 513 · 1067 | 277 · 236 · 236 | 776 · 637 · 637 | ok | authored |
| 2v1v1v1 | 3 + 4 v 0 v 1 v 5 | 236/236 · — · — · — | 748/513 · 513 · 527 · 527 | 277 · 236 · 236 · 236 | 776 · 637 · 637 · 804 | ok | search |
| 3v3 | 2 + 5 + 6 v 3 + 4 + 7 | 222/222/416 · 236/236/402 | 1067/1192/776 · 1067/1178/776 | 222 · 212 | 651 · 647 | ok | authored |

## Riverbank (1800 × 1400 mm; ally ≤ 594 mm, enemy ≥ 540 mm)

| shape | sites by team | ally route (mm) | nearest enemy (mm) | food by team (mm) | middle by team (mm) | limits | source |
|---|---|---|---|---|---|---|---|
| 2v2 | 0 + 1 v 4 + 5 | 333/333 · 333/333 | 1372/1039 · 1039/1372 | 291 · 305 | 873 · 852 | ok | authored |
| 2v1 (you + an AI ally v one AI) | 3 + 4 v 7 | 346/346 · — | 1025/1303 · 1025 | 187 · 180 | 582 · 582 | ok | authored |
| 3v1 | 2 + 3 + 4 v 7 | 333/333/346 · — | 1136/1025/1303 · 1025 | 180 · 180 | 573 · 582 | ok | authored |
| 2v2v2 | 0 + 1 v 4 + 5 v 8 + 9 | 333/333 · 333/333 · 443/443 | 1372/1039 · 1012/1067 · 1012/1081 | 291 · 305 · 229 | 873 · 852 · 665 | ok | authored |
| 2v1v1 (you + an AI ally v two AIs on their own) | 4 + 5 v 1 v 9 | 333/333 · — · — | 1039/1122 · 1039 · 1081 | 305 · 277 · 194 | 852 · 707 · 818 | ok | authored |
| 2v1v1v1 | 4 + 5 v 1 v 6 v 9 | 333/333 · — · — · — | 1039/1122 · 818 · 818 · 1081 | 305 · 277 · 263 · 194 | 852 · 707 · 721 · 818 | ok | search |
| 3v3 | 1 + 2 + 3 v 7 + 8 + 9 | 360/333/333 · 457/443/443 | 1012/1067/956 · 1012/956/1150 | 217 · 212 | 568 · 637 | ok | authored |

## Rainforest (1500 × 1500 mm; ally ≤ 495 mm, enemy ≥ 450 mm)

| shape | sites by team | ally route (mm) | nearest enemy (mm) | food by team (mm) | middle by team (mm) | limits | source |
|---|---|---|---|---|---|---|---|
| 2v2 | 7 + 8 v 6 + 9 | 208/208 · 222/222 | 1136/942 · 1150/942 | 180 · 180 | 568 · 575 | ok | authored |
| 2v1 (you + an AI ally v one AI) | 7 + 8 v 9 | 208/208 · — | 1136/942 · 942 | 180 · 125 | 568 · 471 | ok | authored |
| 3v1 | 2 + 7 + 8 v 6 | 485/208/208 · — | 1524/1344/1150 · 1150 | 194 · 236 | 679 · 679 | ok | authored |
| 2v2v2 | 1 + 5 v 6 + 9 v 7 + 8 | 637/637 · 222/222 · 208/208 | 651/679 · 901/679 · 651/859 | 624 · 180 · 180 | 859 · 575 · 568 | colony 0: ally 637 mm away (limit 495); colony 1: ally 637 mm away (limit 495) | authored |
| 2v1v1 (you + an AI ally v two AIs on their own) | 7 + 8 v 6 v 5 | 208/208 · — · — | 1025/1067 · 901 · 901 | 180 · 236 · 360 | 568 · 679 · 651 | ok | authored |
| 2v1v1v1 | 7 + 8 v 2 v 3 v 6 | 208/208 · — · — · — | 527/485 · 485 · 540 · 540 | 180 · 222 · 222 · 236 | 568 · 901 · 901 · 679 | ok | search |
| 3v3 | 2 + 7 + 8 v 3 + 6 + 9 | 485/208/208 · 485/222/222 | 1358/1136/942 · 1358/1150/942 | 194 · 194 | 679 · 684 | ok | authored |

## Savanna (1800 × 1800 mm; ally ≤ 594 mm, enemy ≥ 540 mm)

| shape | sites by team | ally route (mm) | nearest enemy (mm) | food by team (mm) | middle by team (mm) | limits | source |
|---|---|---|---|---|---|---|---|
| 2v2 | 2 + 8 v 3 + 9 | 333/333 · 319/319 | 1275/942 · 1261/942 | 236 · 229 | 762 · 533 | ok | authored |
| 2v1 (you + an AI ally v one AI) | 2 + 8 v 3 | 333/333 · — | 1593/1261 · 1261 | 236 · 208 | 762 · 693 | ok | authored |
| 3v1 | 1 + 5 + 7 v 6 | 416/430/416 · — | 1219/1219/1012 · 1012 | 314 · 236 | 610 · 637 | ok | authored |
| 2v2v2 | 2 + 8 v 0 + 6 v 3 + 9 | 333/333 · 402/402 · 319/319 | 804/637 · 637/637 · 928/637 | 236 · 305 · 229 | 762 · 741 · 533 | ok | authored |
| 2v1v1 (you + an AI ally v two AIs on their own) | 1 + 7 v 6 v 8 | 416/416 · — · — | 637/651 · 637 · 637 | 298 · 236 · 249 | 575 · 637 · 596 | ok | authored |
| 2v1v1v1 | 1 + 7 v 3 v 6 v 8 | 416/416 · — · — · — | 637/651 · 790 · 637 · 637 | 298 · 208 · 236 · 249 | 575 · 693 · 637 · 596 | ok | search |
| 3v3 | 1 + 5 + 7 v 0 + 4 + 6 | 416/430/416 · 402/443/402 | 1219/1219/1012 · 1219/1219/1012 | 314 · 319 | 610 · 841 | ok | authored |

