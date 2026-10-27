# Sounds (public)

このフォルダは Vite の `public` フォルダです。ここに置いたファイルはビルド時に `dist/assets/sounds/` へコピーされず、`dist/sounds/` 直下にコピーされますが、サーバーは `assets/sounds/` を優先して配信するため、**両方に同じファイルを置く**のが最も確実です。

詳細は `assets/sounds/README.md` を参照してください。

- 対応名: `bgm` / `dig` / `break` / `place` / `hit` / `step` / `pop` / `chestOpen` / `chestClose` / `craft`
- 形式: `mp3` > `ogg` > `wav` の優先順

例:
```
web/public/sounds/bgm.mp3
web/public/sounds/dig.mp3
assets/sounds/bgm.mp3  # 本番用にもコピー
```
