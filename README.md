# 日経平均 3D ヒートマップ (Nikkei 225 · 3D Heatmap)

株価指数のヒートマップは finviz や nikkei225jp.com のように **2次元（平面）** の
treemap が一般的です。本プロジェクトはそこに **高さ（第3の次元）** を加え、
カーソルのドラッグで **360度回転** できるインタラクティブな 3D ヒートマップです。
まずは **日経平均225** を対象としています。

<img src="docs/preview.png" alt="preview" width="640">

## エンコーディング

| 視覚要素 | 意味 |
| --- | --- |
| **面積**（footprint, w×d） | **寄与度**（\|contribution\|）— 従来の2Dヒートマップと同じ |
| **高さ**（height） | **騰落率(%)**。0% を基準面とし、**プラスは上方向 / マイナスは下方向**へ厚みを持たせる（新設） |
| **色** | 騰落（**緑=上昇 / 赤=下落**、finviz式）。高さと併用 |

銘柄は **業種（セクター）ごとにグルーピング** した squarified treemap で配置します。

## 操作

- **ドラッグ**：360度回転
- **ホイール / ピンチ**：拡大・縮小
- **右ドラッグ**：平行移動
- **ホバー**：銘柄名・コード・業種・騰落率・寄与度をツールチップ表示
- **期間ボタン**：`1D / 1W / 1M / 3M / 6M / YTD / 1Y` を切り替え（滑らかにアニメーション）
- **透明度スライダー**（右下）：棒の透明度を 20〜100% で調整（奥の棒を見通せる）

## 実行 / プレビュー

依存を落とさず静的ファイルのみで動きます（ビルド不要）。

```bash
python3 -m http.server 8000
# → http://localhost:8000/
```

Three.js は CDN 不達でも動くよう `lib/` に同梱（バージョン固定）しています。

## 構成

```
index.html            エントリ（importmap で three / OrbitControls を解決）
css/style.css         UI（期間バー・凡例・ツールチップ）
lib/                  three.module.js / OrbitControls.js（vendor）
js/main.js            scene / camera / OrbitControls / ライト / 地面 / レンダーループ
js/treemap.js         squarified treemap（業種→銘柄の2階層）
js/heatmap.js         bar mesh・色・ラベル・期間切替アニメ
js/color.js           騰落率(%) → 色
js/ui.js              期間ボタン・ツールチップ・凡例・透明度スライダー
js/data-source.js     データ読み込み層（サンプル / リモートAPI切替・JPX変換）
data/ni225.js         サンプルデータ（全7期間 × 225銘柄）
scripts/gen_sample.mjs サンプルデータ生成スクリプト
```

## データの差し替え（実データ連携）

現状の `data/ni225.js` は **サンプルデータ**（実在の株価ではありません）です。
`window.NI225_DATA` を同じ形にして差し替えるだけで実データに移行できます。

```js
window.NI225_DATA = {
  "1D": {
    asOf: "2026-07-28T15:00:00+09:00",
    constituents: [
      { code: "6857", name: "アドバンテスト", sector: "電気機器",
        contribution: -687.87,  // 寄与度（符号付き, 指数ポイント）
        changePct: -10.04 },    // 騰落率(%)
      /* … 225銘柄 … */
    ]
  },
  "1W": { … }, "1M": { … }, "3M": { … }, "6M": { … }, "YTD": { … }, "1Y": { … }
};
```

サンプルの再生成:

```bash
node scripts/gen_sample.mjs   # → data/ni225.js を出力
```

### JPX API連携（実データ）

`js/data-source.js` の `CONFIG.endpoint` にバックエンドのURLを設定すると、
サンプルの代わりにそのAPIから取得します（返却は上記と同じ形）。

```js
// js/data-source.js
export const CONFIG = { endpoint: 'https://<your-host>/api/ni225-heatmap' };
```

**なぜバックエンドが必要か**：JPXの株価API（例: 15分遅延 株価情報API）は
**有料・認証必須**で、ブラウザからの直接呼び出し（CORS）ができません。また
APIが返すのは*株価*であり、寄与度は別途計算が必要です。そこで小さなサーバ
（プロキシ）でAPIキーを保持し、株価を取得→寄与度を計算→上記JSONを返します。

寄与度の計算（`fromJpxQuotes()` に実装済み。日経平均は株価換算係数付きの
株価平均型指数）:

```
指数        = Σ(株価 × 換算係数) / 除数
騰落率(%)   = (現在値 − 前日終値) / 前日終値 × 100
寄与度      = 換算係数 × (現在値 − 前日終値) / 除数   （指数ポイント）
```

したがってサーバ側では、JPXの株価に加えて **各銘柄の換算係数（PAF）** と
**日経平均の除数（Divisor）** が必要です（いずれも指数公表元の値）。

## markets-lab.com への埋め込み

一式（このフォルダ）をホスティングし、iframe で埋め込みます。

```html
<iframe src="https://<host>/nikkei225-3d-heatmap/"
        style="width:100%;height:80vh;border:0;" loading="lazy"
        title="日経平均 3D ヒートマップ"></iframe>
```

## ライセンス

MIT
