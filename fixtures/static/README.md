# Static fixtures

Files here are committed because the generator cannot make them (CI runners have no `mutool`); `pnpm fixtures` copies them into `fixtures/generated/`.

## locked.pdf

An AES-128 encrypted PDF whose open password is `learn` (no owner restrictions beyond the default). Made once from the generated `sample.pdf` with:

```
mutool convert -O encrypt=aes-128,user-password=learn -o fixtures/static/locked.pdf fixtures/generated/sample.pdf
```

pdf-lib 1.17.1 cannot write encrypted files. The content is the three pages of `sample.pdf`, made by this repository's own script, so it carries no third-party work.
