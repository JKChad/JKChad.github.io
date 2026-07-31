# NIGHT SHIFT visual regression tests

These tests boot the built game at `#visual=1`, install `src/testing/VisualHarness.js`, and capture fixed camera PNGs into:

- `tests/visual/__tmp__/`

The comparator checks those captures against:

- `tests/visual/baselines/`

## Commands

```sh
npm run test:visual
npm run test:visual:update
```

Use `test:visual:update` when intentionally changing the scene lighting or camera fixtures. The first update run creates the baseline PNGs.

## Cameras

`tests/visual/cameras.json` fixes coverage for:

- center warm light pool
- far extract doorway
- warm desk lamp

The default threshold is 2% significant pixels with a matching MAE cap. This is intended to fail when authored light pools stop reading, while allowing small software GL differences.

The runner uses `puppeteer-core` with system Chrome and SwiftShader flags, matching the smoke test environment.
