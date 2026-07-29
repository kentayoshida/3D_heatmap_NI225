# 3D 株価指数ヒートマップ (3D Stock-Index Heatmap)

株価指数のヒートマップは finviz や nikkei225jp.com のように **2次元（平面）** の
treemap が一般的です。本プロジェクトはそこに **高さ（第3の次元）** を加え、
カーソルのドラッグで **360度回転** できるインタラクティブな 3D ヒートマップです。
画面右上のスイッチャーで **3指数** を切り替えられます:

- **NIKKEI** … 日経平均225（株価加重・J-Quants）
- **DOW30** … NYダウ工業株30種（株価加重・Yahoo Finance）
- **NASDAQ 100** … NASDAQ 100指数（時価総額加重・Yahoo Finance）

<img src="docs/preview.png" alt="preview" width="640">

## エンコーディング

| 視覚要素 | 意味 |
| --- | --- |
| **面積**（footprint, w×d） | **寄与度**（\|contribution\|）— 従来の2Dヒートマップと同じ |
| **高さ**（height） | **騰落率(%)**。0% を基準面とし、**プラスは上方向 / マイナスは下方向**へ厚みを持たせる（新設） |
| **色** | 騰落（**緑=上昇 / 赤=下落**、finviz式）。高さと併用 |

銘柄は **業種（セクター）ごとにグルーピング** した squarified treemap で配置します
（日経=33業種、米国=英語のGICSセクター）。

**寄与度の定義（指数の加重方式ごと）**

| 指数 | 加重方式 | 寄与度（面積 ∝ \|contribution\|） |
| --- | --- | --- |
| NIKKEI 225 | 株価加重 | `換算係数(PAF) × (現在値−基準値) / 除数` |
| DOW30 | 株価加重 | `(現在値−基準値) / 除数`（除数は `Σ最新終値 / ^DJI` から導出） |
| NASDAQ 100 | 時価総額加重 | `指数レベル(^NDX) × 構成ウェイト% × 騰落率%` |

## 操作

- **ドラッグ**：360度回転
- **ホイール / ピンチ**：拡大・縮小
- **右ドラッグ**：平行移動
- **ホバー**：銘柄名・コード・業種・騰落率・寄与度をツールチップ表示
- **期間ボタン**（上中央）：`1D / 1W / 1M / 3M / 6M / YTD / 1Y` を切り替え（滑らかにアニメーション）
- **指数スイッチャー**（右上）：`NIKKEI / DOW30 / NASDAQ 100` を切り替え（初回のみ遅延読込＋キャッシュ）
- **透明度スライダー**（右下）：棒の透明度を 20〜100% で調整（奥の棒を見通せる）

## 実行 / プレビュー

依存を落とさず静的ファイルのみで動きます（ビルド不要）。配信物は `public/` 配下です。

```bash
npx http-server public -p 8000 -c-1
# → http://localhost:8000/   (-c-1 でキャッシュ無効。反映されない時に有効)
```

Three.js は CDN 不達でも動くよう `public/lib/` に同梱（バージョン固定）しています。

## 構成

```
public/                配信物（Cloudflare Pages の出力ディレクトリ）
  index.html           エントリ（importmap で three / OrbitControls を解決）
  css/style.css        UI（期間バー・凡例・ツールチップ・透明度・向き）
  lib/                 three.module.js / OrbitControls.js（vendor）
  js/main.js           scene / camera / OrbitControls / ライト / 地面 / ループ
  js/treemap.js        squarified treemap（業種→銘柄の2階層）
  js/heatmap.js        bar mesh・色・ラベル・期間切替アニメ・透明度/X線・凹凸反転
  js/color.js          騰落率(%) → 色
  js/ui.js             期間ボタン・ツールチップ・凡例・透明度スライダー・向きトグル
  js/data-source.js    データ読み込み層（指数別エンドポイント・サンプルフォールバック）
  data/ni225.js        NIKKEI サンプル（window.HEATMAP_SAMPLE.NIKKEI）
  data/dow30.js        DOW30 サンプル（window.HEATMAP_SAMPLE.DOW30）
  data/nasdaq100.js    NASDAQ100 サンプル（window.HEATMAP_SAMPLE.NASDAQ100）
  _headers             Cloudflare Pages のキャッシュ設定
scripts/gen_sample.mjs    NIKKEI サンプル生成スクリプト
scripts/gen_sample_us.mjs DOW30 / NASDAQ100 サンプル生成スクリプト
server/                データプロキシ（Cloudflare Worker）
  worker.js               NIKKEI: J-Quants V2 → 寄与度
  us-worker.js            DOW30 / NASDAQ100: Yahoo Finance → 寄与度（?index=dow|nasdaq）
  build-params.mjs        NIKKEI パラメータ（PAF・除数）ビルド
  build-us-params.mjs     米国パラメータ（構成銘柄・NASDAQウェイト）ビルド
  us-constituents.mjs     Dow30 / Nasdaq100 の構成銘柄（共有）
  wrangler.toml           NIKKEI Worker 設定
  wrangler-us.toml        米国 Worker 設定
```

## デプロイ（Cloudflare Pages · Git連携）

`public/` を配信します。Cloudflare Pages でこのリポジトリを接続し:

- **Build command**: （空）
- **Build output directory**: `public`
- **Production branch**: 運用ブランチ（例: `main`）

以後は push で自動デプロイ。カスタムドメインに `3dheatmap.markets-lab.com` を追加します。

データAPI（Worker）は2つあり、それぞれ独立にデプロイします（`server/` 配下）:

```bash
cd server
# NIKKEI（J-Quants V2 / 要APIキー）
wrangler secret put JQUANTS_API_KEY   # 初回のみ
wrangler deploy                       # wrangler.toml を使用

# DOW30 / NASDAQ100（Yahoo Finance / キー不要）
wrangler deploy --config wrangler-us.toml
```

デプロイ先URLをフロントの `js/data-source.js` の `CONFIG.endpoints` に設定します
（米国は `?index=dow` / `?index=nasdaq` を付与）。いずれかが不達でも、該当指数は
バンドル済みサンプルに自動フォールバックします。

## データの差し替え（実データ連携）

`public/data/*.js` は **サンプルデータ**（実在の株価ではありません）で、ライブAPIが
不達のときのフォールバックです。各指数は `window.HEATMAP_SAMPLE[indexKey]` に同じ形で
格納されます（`indexKey` = `NIKKEI` / `DOW30` / `NASDAQ100`）。

```js
window.HEATMAP_SAMPLE['NIKKEI'] = {
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
node scripts/gen_sample.mjs      # → public/data/ni225.js
node scripts/gen_sample_us.mjs   # → public/data/dow30.js, public/data/nasdaq100.js
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

### 米国指数（DOW30 / NASDAQ100）— Yahoo Finance連携

米国2指数は `server/us-worker.js`（Cloudflare Worker）が **Yahoo Finance** から
日足を取得し、寄与度を計算して同じ形のJSONを返します（`?index=dow` / `?index=nasdaq`）。
Yahoo は **APIキー不要** ですが、ブラウザ直叩き（CORS）とレート制限のためプロキシ経由にします。

- 構成銘柄・NASDAQのウェイトは `server/us-constituents.mjs`（同梱シード）にあり、
  `node server/build-us-params.mjs` で `server/us-index-params.json` を生成します。
- **NASDAQのウェイトを最新化**するには、Invesco QQQ の保有CSVを
  `server/qqq_holdings.csv` に置いて（`Ticker` / `Name` / `Weight` / `Sector` 列）
  再ビルドします（CSVがあれば同梱シードより優先）。
- DOWは株価加重のため、Workerが `^DJI` から除数を導出します（ウェイト不要）。
- Yahoo は非公式APIのため、レート制限や仕様変更で不安定になる場合があります。その際は
  該当指数がサンプルへフォールバックします（恒常運用ではAPIキー型プロバイダへ差し替え可）。

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
<iframe src="https://3dheatmap.markets-lab.com/"
        style="width:100%;height:80vh;border:0;" loading="lazy"
        title="3D 株価指数ヒートマップ"></iframe>
```

## ライセンス

MIT
