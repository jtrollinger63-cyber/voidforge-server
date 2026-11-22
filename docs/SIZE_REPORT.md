# Release size report

File: `release/hillfront.html`  ·  generated 2026-11-22T19:54:45.546Z

**Total: 2,541,872 bytes (2.42 MB)** against a budget of 12 MB (12,582,912 bytes): PASS

Gzip-compressed transfer size (if served with compression): 0.72 MB. Embedding in Google Sites counts the *uncompressed* HTML, so the gate uses the first number.

| Category | Bytes | Size | Share |
|---|---:|---:|---:|
| Game code (three.js + game + UI, minified JS) | 860,684 | 841 KB | 33.9% |
| 3D models (soldier, map kit, weapons) as base64 | 1,666,135 | 1627 KB | 65.5% |
| CSS | 14,826 | 14 KB | 0.6% |
| HTML shell / other | 227 | 0 KB | 0.0% |

Models embedded: 3 (901 KB, 514 KB, 212 KB base64; base64 adds ~33 % over the raw GLB).

Not in the file: textures for the ground and soldiers are painted at runtime on a canvas (0 bytes shipped); all audio is synthesised at runtime (0 bytes).

GPU/CPU memory after decoding is tracked separately: see docs/PERFORMANCE.md (measured at runtime via `renderer.info`).
