"""Turn the Rocketbox Female_Adult_03 textures into the Mahakali look.

* Skin  -> deep midnight blue. Detail (pores, shading, freckles) is kept by
  re-using each pixel's luminance relative to the average skin tone.
* Lips  -> dark plum-red.
* Tunic -> crimson silk with a woven gold "butti" motif.
* Trousers / shoes -> dark maroon (mostly hidden under the lehenga skirt).
* Specular -> roughness maps for the PBR materials.

Usage: python3 scripts/process_textures.py <rocketbox Textures dir> <output dir>
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
SIZE = 2048

def load(name, mode="RGB"):
    return np.asarray(Image.open(f"{SRC}/f003_{name}.tga").convert(mode)).astype(np.float32) / 255.0

def save(arr, name, quality=88):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    if img.size[0] != SIZE:
        img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(f"{OUT}/{name}.jpg", quality=quality, optimize=True)

def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn + 1e-6
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0)
    return h, s, mx

def blur_mask(m, radius=2.0):
    img = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(img).astype(np.float32) / 255.0

def srgb(hex_):
    return np.array([int(hex_[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], np.float32)

# Midnight-blue skin ramp (sRGB): shadow -> base -> highlight
SKIN_LO, SKIN_MID, SKIN_HI = srgb("#020309"), srgb("#0e1631"), srgb("#2c3d6e")

def skin_ramp(rel):
    """rel = pixel luminance / mean skin luminance (≈1 for average skin)."""
    rel = rel[..., None]
    lo = SKIN_LO + (SKIN_MID - SKIN_LO) * np.clip(rel, 0, 1)
    hi = SKIN_MID + (SKIN_HI - SKIN_MID) * np.clip((rel - 1) / 0.6, 0, 1)
    return np.where(rel < 1, lo, hi)

SKIN_REF_LUM = 0.5

def skin_mask(rgb):
    h, s, v = rgb_to_hsv(rgb)
    hue_ok = (h < 0.13) | (h > 0.94)
    m = hue_ok & (s > 0.18) & (s < 0.8) & (v > 0.22)
    return m.astype(np.float32)

def luminance(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)

# The scan's own blood/flush variation (how much redder than average a pixel
# is) becomes a violet flush on cheeks, nose, ears and knuckles, and a cooler
# slate tone where the skin was sallow. This keeps the face from reading as a
# flat, single-hue paint job.
SKIN_REF_RED = 0.31  # median redness of the source scan's skin

def recolor_skin(rgb, mask):
    lum = luminance(rgb)
    # one shared reference so head and body textures match at the neck seam
    blue = skin_ramp(lum / SKIN_REF_LUM)
    redness = (rgb[..., 0] - rgb[..., 1]) / (rgb[..., 0] + 1e-3)
    flush = np.clip((redness - SKIN_REF_RED) / 0.06, -1, 1)
    flush = blur_mask((flush * 0.5 + 0.5).astype(np.float32), 3.0) * 2 - 1
    violet = blue * np.array([1.45, 0.86, 1.08], np.float32)
    slate = blue * np.array([0.86, 1.02, 1.08], np.float32)
    f = flush[..., None]
    blue = np.where(f > 0, blue + (violet - blue) * f * 0.75, blue + (slate - blue) * (-f) * 0.5)
    m = blur_mask(mask, 1.5)[..., None]
    return rgb * (1 - m) + blue * m, m[..., 0]

def uv_grid():
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / SIZE
    return x, y

# ---------------------------------------------------------------- head
head = load("head_color")
mask = skin_mask(head)
x, y = uv_grid()
mouth_eye_atlas = ((x < 0.14) & (y > 0.685)) | (((x - 0.265) ** 2 + (y - 0.925) ** 2) < 0.07 ** 2)  # teeth/tongue/eyeball
mask[mouth_eye_atlas] = 0
head_out, m = recolor_skin(head, mask)

# lips: an ellipse around the mouth in the face island
lips = (((x - 0.5) / 0.075) ** 2 + ((y - 0.398) / 0.03) ** 2) < 1
h, s, v = rgb_to_hsv(head)
lip_px = lips & ((h < 0.03) | (h > 0.9)) & (s > 0.3)
lip_m = blur_mask(lip_px.astype(np.float32), 2.5)[..., None]
lip_col = srgb("#3b0a1a") * np.clip(luminance(head) / 0.4, 0.4, 1.5)[..., None]
lip_m = lip_m * 0.85
head_out = head_out * (1 - lip_m) + lip_col * lip_m

# kohl: darken the purple eyeshadow area into smoky midnight
shadow = (((np.abs(x - 0.5) - 0.072) / 0.05) ** 2 + ((y - 0.272) / 0.02) ** 2) < 1
head_out[shadow] *= 0.55

# slender red tilak on the brow: a vertical flame-shaped mark
ty = (y - 0.205) / 0.05                                    # 0 at top, 1 at bottom
half_w = 0.0032 * np.abs(np.sin(np.clip(ty, 0, 1) * np.pi)) ** 0.8
tilak = (np.abs(x - 0.5) < half_w) & (ty > 0) & (ty < 1)
tm = blur_mask(tilak.astype(np.float32), 1.0)[..., None] * 0.9
head_out = head_out * (1 - tm) + srgb("#9e0f18") * tm
# eyes: deepen the iris (dark brown-black) and soften the sclera
IRIS_C, IRIS_R = (0.2637, 0.9331), 0.0172   # measured on the source eyeball texture
er = np.sqrt((x - IRIS_C[0]) ** 2 + (y - IRIS_C[1]) ** 2)
iris = blur_mask((er < IRIS_R).astype(np.float32), 2)[..., None]
head_out = head_out * (1 - iris * 0.45)
sclera = blur_mask(((er >= IRIS_R) & (er < 0.06)).astype(np.float32), 3)[..., None]
head_out = head_out * (1 - sclera * 0.18)
# eye occlusion: the sclera darkens toward the lids and corners, never paper-white
ao = np.clip((er - 0.03) / 0.035, 0, 1) ** 1.5
eye_island = (er < 0.07)[..., None]
head_out = np.where(eye_island, head_out * (1 - 0.5 * ao[..., None]) * np.array([0.92, 0.9, 0.93], np.float32), head_out)
# limbal ring: a thin dark ring at the iris edge gives the eye depth
limbal = blur_mask((np.abs(er - IRIS_R) < 0.002).astype(np.float32), 1.2)[..., None]
head_out = head_out * (1 - limbal * 0.6)

# hair: neutral blue-black instead of brown
hair = (v < 0.3) & (mask < 0.5) & ~mouth_eye_atlas
hm = blur_mask(hair.astype(np.float32), 1.0)[..., None]
hair_col = luminance(head)[..., None] * srgb("#8c96b4") * 0.9
head_out = head_out * (1 - hm) + hair_col * hm
save(head_out, "head_color")

# ---------------------------------------------------------------- body
body = load("body_color")
# remove the small arm tattoo of the source character (soft inpaint from blurred skin)
tat = (((x - 0.285) / 0.04) ** 2 + ((y - 0.4) / 0.045) ** 2) < 1
soft = np.asarray(Image.fromarray((body * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(40))).astype(np.float32) / 255
tm = blur_mask(tat.astype(np.float32), 8)[..., None]
body = body * (1 - tm) + soft * tm
h, s, v = rgb_to_hsv(body)
bmask = skin_mask(body)
purple = (h > 0.72) & (h < 0.93) & (s > 0.25)
bmask[purple] = 0
body_out, bm = recolor_skin(body, bmask)

# tunic: purple -> crimson silk, preserving the fabric's shading
pm = blur_mask(purple.astype(np.float32), 1.0)[..., None]
lum = luminance(body)[..., None]
crimson = srgb("#6e0812") * np.clip(lum / 0.4, 0.15, 1.4)
# woven gold buttis on a diagonal lattice
gx, gy = x * 110.0, y * 110.0
u = (gx + gy) % 1.0 - 0.5
w = (gx - gy) % 1.0 - 0.5
r = np.sqrt(u * u + w * w)
motif = (r < 0.1).astype(np.float32) * 0.85
ring = (np.abs(r - 0.3) < 0.03).astype(np.float32) * 0.35
gold_m = np.clip(blur_mask(motif, 0.6) + blur_mask(ring, 0.5), 0, 1)[..., None]
gold = srgb("#d9a441") * np.clip(lum / 0.35, 0.5, 1.4)
tunic = crimson * (1 - gold_m) + gold * gold_m
# gota-patti piping: a gold band along every edge of the garment (hems, neckline, seams)
pmask = Image.fromarray((purple * 255).astype(np.uint8))
inner = np.asarray(pmask.filter(ImageFilter.MinFilter(25))).astype(np.float32) / 255.0
band = np.clip(purple.astype(np.float32) - inner, 0, 1)
band = blur_mask(band, 1.2)[..., None]
zari = srgb("#c9952f") * np.clip(lum / 0.4, 0.6, 1.3)
# fine woven stripes inside the band
zari = zari * (0.8 + 0.2 * np.sin((x + y) * SIZE * 0.9)[..., None])
tunic = tunic * (1 - band) + zari * band
gold_m = np.clip(gold_m + band, 0, 1)
body_out = body_out * (1 - pm) + tunic * pm

# trousers / shoes (dark neutral) -> deep maroon
dark = (v < 0.3) & ~purple & (bmask < 0.5)
dm = blur_mask(dark.astype(np.float32), 1.0)[..., None]
body_out = body_out * (1 - dm) + (srgb("#24040a") * np.clip(lum / 0.12, 0.3, 1.6)) * dm
save(body_out, "body_color")

# R = skin mask (drives the oily clear-coat layer and pore detail), G = roughness, B = metalness
for part, src_rgb, skin_m, cloth_gold in (("head", head, m, None), ("body", body, bm, gold_m[..., 0] * pm[..., 0])):
    spec = luminance(load(f"{part}_specular"))
    rough = np.clip(0.72 - spec * 1.4, 0.45, 0.9)             # skin: soft sheen with oilier T-zone
    rough = rough * skin_m + (0.72 if part == "head" else 0.55) * (1 - skin_m)  # hair / cloth default
    metal = np.zeros_like(rough)
    if cloth_gold is not None:
        rough = rough * (1 - cloth_gold) + 0.35 * cloth_gold
        metal = cloth_gold * 0.9
    coat = np.clip(skin_m, 0, 1)
    if part == "head":
        coat = np.maximum(coat, lip_m[..., 0] * 1.0)               # lips are glossier
        rough = rough * (1 - lip_m[..., 0] * 0.4)
    orm = np.stack([coat, rough, metal], -1)
    save(orm, f"{part}_orm", quality=90)
    nrm = load(f"{part}_normal")
    save(nrm, f"{part}_normal", quality=92)

# hair / eyelash cards keep their alpha -> PNG
op = Image.open(f"{SRC}/f003_opacity_color.tga").convert("RGBA").resize((1024, 1024), Image.LANCZOS)
op.save(f"{OUT}/hair_cards.png", optimize=True)
print("textures written to", OUT)
