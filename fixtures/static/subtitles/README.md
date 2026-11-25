# Subtitle fixtures

Every file here was written by this repository; the sentences are lecture text about cell biology, so they carry no third-party work.

- `lecture-60s.ko.srt` — 16 cues within 60 seconds (a two-line cue, an overlapping cue, markup and an entity, "칼슘 펌프" twice, and the extended CP949 syllables 똠 햏 갂).
- `lecture-60s.en.vtt` — the same 16 cues in English as WebVTT (a `Language` header, NOTE and STYLE blocks, identifier lines, a cue setting).
- `broken.srt` — three lines of text with no time line.
- `notes.ko.srt` — two valid cues, for a subtitle with no video of its name.
- `cp949.srt` — `lecture-60s.ko.srt` re-encoded as CP949. Remake it with:

```sh
python3 -I scripts/build-cp949.py --fixture fixtures/static/subtitles/lecture-60s.ko.srt fixtures/static/subtitles/cp949.srt
```

`pnpm fixtures` copies the committed files into `fixtures/generated/` and builds the rest (`lecture-60s.mp4`, the BOM and UTF-16 variants, and the size-limit files).
