# 桌面手机视口自动验收

## wiki-mobile
- pass: ['G1: no mass ellipsis', 'G1: first ok at ~3s', 'G1: 31 ok segments', 'G4: history heading box not vertically squeezed']
- fail: []
- firstOkAt: 3s
- ok/fail hosts: 31/30

## google-mobile
- pass: ['G1: no mass ellipsis', 'G1: first ok at ~1s', 'G1: 5 ok segments']
- fail: []
- firstOkAt: 1s
- ok/fail hosts: 5/5

## ookla-about-mobile
- pass: ['G1: no mass ellipsis', 'G1: first ok at ~3s', 'G1: 36 ok segments']
- fail: []
- firstOkAt: 3s
- ok/fail hosts: 36/45

仍见：失败段比例偏高（维基约一半标记 fail），但已无满屏…，首屏约 1～3s 出译文。
