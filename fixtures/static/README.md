# Static fixtures

Files here are committed because the generator cannot make them (CI runners have no `mutool`); `pnpm fixtures` copies them into `fixtures/generated/`.

## locked.pdf

An AES-128 encrypted PDF whose open password is `learn` (no owner restrictions beyond the default). Made once from the generated `sample.pdf` with:

```
mutool convert -O encrypt=aes-128,user-password=learn -o fixtures/static/locked.pdf fixtures/generated/sample.pdf
```

pdf-lib 1.17.1 cannot write encrypted files. The content is the three pages of `sample.pdf`, made by this repository's own script, so it carries no third-party work.

## images/

Five small raster images for the image sniff and size tests (PNG with alpha, JPEG with EXIF orientation 6, lossless WebP with alpha, a two-frame GIF, a still AVIF). They are not copied into `generated/`; tests read them from here. Made with ImageMagick 7 and ffmpeg (`magick -orient` writes no EXIF, so the orientation tag is added by a short node script):

```sh
magick -size 64x48 gradient:'#2a6fdb-#f2c94c' -alpha set -channel A -fx 'i<32?1:0.25' +channel -depth 8 fixtures/static/images/transparent.png
magick -size 60x40 gradient:'#2a6fdb-#f2c94c' -quality 85 "$TMPDIR/base.jpg"
node --input-type=module -e "import fs from 'node:fs'; const [s, d] = process.argv.slice(1); const j = fs.readFileSync(s); const t = Buffer.from([0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]); const b = Buffer.concat([Buffer.from('Exif\0\0','latin1'), t]); const l = Buffer.alloc(2); l.writeUInt16BE(b.length + 2); fs.writeFileSync(d, Buffer.concat([j.subarray(0,2), Buffer.from([0xff,0xe1]), l, b, j.subarray(2)]));" "$TMPDIR/base.jpg" fixtures/static/images/orient6.jpg
magick -size 48x32 gradient:'#2a6fdb-#f2c94c' -alpha set -channel A -fx 'j<16?1:0.5' +channel -define webp:lossless=true fixtures/static/images/alpha.webp
magick -delay 50 -size 24x16 xc:'#2a6fdb' xc:'#f2c94c' -loop 0 fixtures/static/images/two-frames.gif
ffmpeg -v error -y -f lavfi -i testsrc2=size=40x30:rate=1 -frames:v 1 -c:v libaom-av1 -still-picture 1 -pix_fmt yuv420p fixtures/static/images/still.avif
```

Check with `magick identify -format '%f %w %h %[orientation]\n' fixtures/static/images/*`:

```
alpha.webp 48 32 Undefined
orient6.jpg 60 40 RightTop
still.avif 40 30 TopLeft
transparent.png 64 48 Undefined
two-frames.gif 24 16 Undefined
```

(`two-frames.gif` prints once per frame.) The pictures are gradients and a test pattern made here, so they carry no third-party work.
