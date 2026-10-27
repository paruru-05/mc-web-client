# Sound Assets — 効果音・BGMのカスタマイズ

このフォルダに音声ファイルを置くだけで、ゲーム内の効果音やBGMを差し替えできます。再ビルドは不要です。

## 1. 置き場所

Vite（開発時）と Express（本番）の両方から読めるように、**2箇所のどちらか（または両方）に同じファイルを置いてください**。

| 環境 | パス | 説明 |
|------|------|------|
| 本番（`node server/index.js`） | `assets/sounds/<name>.mp3` | Express が `/assets` を配信 |
| 開発（`npm run dev --prefix web`） | `web/public/sounds/<name>.mp3` | Vite が `public` を配信（`dist` にコピー） |

**推奨**: 両方に同じファイルをコピーしてください。片方だけでも動作しますが、ビルド後は `assets/sounds/` が優先されます。

例:
```
assets/sounds/bgm.mp3
assets/sounds/dig.mp3
assets/sounds/break.mp3
web/public/sounds/bgm.mp3
web/public/sounds/dig.mp3
```

ビルドが必要な場合: `npm run build --prefix web`（`web/public` → `dist` にコピー）

## 2. 対応ファイル形式

- `mp3` 推奨（ブラウザ互換性が最も高い）
- `ogg` / `wav` も可（`mp3` が優先して探索されます）
- `mp3` が見つからなければ `ogg` → `wav` の順でフォールバック

## 3. 適用可能な効果音リスト

`web/src/sound.js` の `SoundManager.play(name)` で呼ばれる名前と用途です。
**同名のファイルを置くと合成音の代わりにファイルが再生されます。**

| ファイル名 | 効果音名 `name` | 用途 | 補足 |
|------------|----------------|------|------|
| `bgm.mp3` / `bgm.ogg` | `bgm` | BGM（ループ） | `SoundManager.startBGM()` が最初に探す。見つからなければシンセパッドが鳴ります。 |
| `dig.mp3` | `dig` | ブロック採掘中（N長押しや左クリック長押しで繰り返し） | 0.07秒のノイズ |
| `break.mp3` | `break` | ブロック破壊完了 | |
| `place.mp3` | `place` | ブロック設置 / 食べ始め / 弓を引き始め | `consume`/`bowPull` でも同じ音が使われます |
| `hit.mp3` | `hit` | エンティティ攻撃 | 左クリックでMob/プレイヤーを叩いた時 |
| `step.mp3` | `step` | 足音 | 歩行時に約380ms間隔で自動再生 |
| `pop.mp3` | `pop` | アイテム取得 | インベントリの個数が増えた時 |
| `chestOpen.mp3` | `chestOpen` | コンテナを開く | チェスト/樽/かまど等、`windowOpen` で鳴ります |
| `chestClose.mp3` | `chestClose` | コンテナを閉じる | `windowClose` で鳴ります |
| `craft.mp3` | `craft` | クラフト成功 | 作業台の【クラフト】ボタンで成功時 |

### 優先探索順

BGM: `/assets/sounds/bgm.mp3` → `/assets/sounds/bgm.ogg` → `/assets/bgm.mp3` → `/assets/bgm.ogg` → シンセ

効果音: `/assets/sounds/<name>.mp3` → `/assets/sounds/<name>.ogg` → `/assets/sounds/<name>.wav` → `/assets/<name>.mp3` → `/sounds/<name>.mp3` → 合成音

> **存在チェックは `HEAD` リクエストで行われます。** 初回再生時に1回だけ探索し、結果は `_customCache` にキャッシュされます（ファイルがあれば以降は即再生、なければ即合成）。

## 4. 追加方法（ステップ）

1. **ファイルを用意**: `mp3`/`ogg`/`wav`（例: Audacity、フリー効果音サイトなど）
2. **配置**:
   ```bash
   cp my-bgm.mp3 assets/sounds/bgm.mp3
   cp my-bgm.mp3 web/public/sounds/bgm.mp3
   cp dig-custom.mp3 assets/sounds/dig.mp3
   cp dig-custom.mp3 web/public/sounds/dig.mp3
   ```
3. **サーバー再起動 or リロード**:
   - 本番: `node server/index.js` を再起動（`assets` は再起動なしでも配信されますが、ブラウザはキャッシュを更新）
   - 開発: `npm run dev` は自動で `public` を配信
   - ブラウザでハードリロード（`Ctrl+Shift+R`）
4. **動作確認**: 対応するアクション（採掘、設置、攻撃、歩行、チェスト開閉、クラフト、歩行）で音が切り替わるか確認。初回は `HEAD` 404 がコンソールに出ても無視されます（フォールバック）。

## 5. 音量・ミュート

- `SoundManager.volume = 0.6`（マスター）、BGM は `0.5`、効果音は `0.18〜0.6` で個別に設定されています。
- ミュート機能は現在キー割り当てなし（以前の `KeyM` は削除済み）。必要なら `web/src/main.js` で任意のキーに `sound.toggleMute()` を割り当ててください。

## 6. 自作例

```bash
# BGMを自作に差し替え
ffmpeg -i my-song.wav -codec:a libmp3lame -qscale:a 2 assets/sounds/bgm.mp3
cp assets/sounds/bgm.mp3 web/public/sounds/bgm.mp3

# 採掘音だけ差し替え
cp ./my-dig.ogg assets/sounds/dig.ogg
cp ./my-dig.ogg web/public/sounds/dig.ogg
# ブラウザで採掘（N長押し）→ my-dig.ogg が再生
```

## 7. トラブルシューティング

- **音が鳴らない**: ブラウザの自動再生ポリシーでブロックされている可能性があります。ページのどこかを一度クリックしてから再試行してください（`SoundManager.init()` は `Connect` クリックで初期化されます）。
- **BGMがシンセのまま**: `assets/sounds/bgm.mp3` が 404 の場合はシンセが鳴ります。開発者ツールの Network タブで `bgm.mp3` のステータスを確認してください。
- **キャッシュ**: 初回探索結果はメモリキャッシュされます。ファイルを置き換えた後はページをリロードしてください。
- **形式**: `mp3` が最も安全です。`ogg` は一部ブラウザで未対応の場合があります。

## 8. ライセンス注意

商用音源やフリー素材を使う場合は、ライセンス（CC0/CC-BYなど）を確認し、必要に応じてクレジットを記載してください。このリポジトリに音源をコミットする場合は、再配布可能な素材のみを使用してください。
