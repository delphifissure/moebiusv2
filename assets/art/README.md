# Paintings (public domain)

Test pictures for the disocclusion work. Each has a working pair the app loads directly and the untouched original.

| name | work | artist, year | why it is here |
|---|---|---|---|
| `jatte` | A Sunday on La Grande Jatte | Georges Seurat, 1884–86 | many figures at many depths; pointillist texture stresses a clean atlas |
| `wanderer` | Wanderer above the Sea of Fog | Caspar David Friedrich, c. 1818 | a figure before layered ridges and fog (the starwatcher case, painted) |
| `caillebotte` | Paris Street; Rainy Day | Gustave Caillebotte, 1877 | people and umbrellas before strong converging street lines |
| `hunters` | Hunters in the Snow | Pieter Bruegel the Elder, 1565 | bare trees and figures before a valley receding through many depths |
| `shishkin` | Morning in a Pine Forest | Ivan Shishkin and Konstantin Savitsky, 1889 | trunks and branches at many depths, a fallen tree across the frame, bears half-hidden behind the log and bushes |
| `wave` | The Great Wave off Kanagawa | Katsushika Hokusai, c. 1831 | thin foam claws before Fuji and sky; depth is ambiguous in a woodblock print |

Files:
- `<name>Img.png` — colour at the working size (≤ 1008 px long side, 8-bit RGB).
- `<name>Depth.png` — Depth Anything 3 Mono-Large (Apache-2.0 checkpoint), 16-bit greyscale inverse depth
  normalised to 0–65535 (bright = near), `process_res=1008`, `upper_bound_resize`. The working size is DA3's processed
  size, so the depth map is never resampled; the colour is resized (Lanczos) to it.
- `originals/<name>.jpg` — the file as supplied (Wikimedia Commons scans), unmodified.

Working sizes: jatte 1008×672, wanderer 784×1008, caillebotte 1008×770, hunters 1008×714, shishkin 1008×686, wave 1008×700.
