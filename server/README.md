# サーバーレス・データプロキシ（J-Quants → 寄与度）

フロントエンドはブラウザから [J-Quants API](https://jpx-jquants.com/) を直接呼べません
（認証・CORS）。このプロキシが認証情報を保持し、J-Quantsの株価から**寄与度**を計算して、
フロントが期待するJSON（全7期間）を返します。

```
J-Quants API (日次株価) ──▶ このWorker（寄与度を計算）──▶ フロント (js/data-source.js)
                            ▲ index-params.json（銘柄・業種・PAF・除数）
```

## 実装状況

- ✅ 認証フロー（`auth_user` → refreshToken → `auth_refresh` → idToken、24hキャッシュ）
- ✅ 日次株価取得（`/prices/daily_quotes?date=` を全銘柄・ページング対応で取得）
- ✅ 全7期間の基準日算出・寄与度計算・整形・CORS・キャッシュ
- ⬜ **`index-params.json` を公式の日経225銘柄コードに差し替え**（下記）
- ⬜ 認証情報（secret）の登録とデプロイ

## J-Quantsについての前提

- **日次（EOD）データ**です。ザラ場のリアルタイムではありません。
  - `1D` = 直近終値 vs 前営業日終値
  - `1W`〜`1Y` = 直近終値 vs 各期間始点の終値
- **データ鮮度はプラン依存**：Freeは約12週間ディレイ。直近日を出すには有料プラン
  （Light/Standard/Premium）が必要です。
- 価格は `AdjustmentClose`（分割調整後）を使用。長期の騰落率が分割で歪みません。
  寄与度は `PAF × (close − base) / 除数` で近似します。

## 認証情報（Cloudflare の例）

```bash
npm i -g wrangler

# どちらか:
wrangler secret put JQUANTS_REFRESH_TOKEN         # 推奨（1週間有効）
# または
wrangler secret put JQUANTS_MAILADDRESS
wrangler secret put JQUANTS_PASSWORD              # 上記からrefreshTokenを自動取得

wrangler deploy
```

デプロイ後、フロントの `js/data-source.js` を設定:

```js
export const CONFIG = { endpoint: 'https://<your-worker>.workers.dev' };
```

## 指数パラメータ（`index-params.json`）

現状はサンプル由来の**シード**（ダミーのフィラー銘柄を含む）です。本番前に
**公式の日経225銘柄コード**へ差し替えてください。

- **銘柄コードと採用可否**：日経（[日経平均プロフィル 構成銘柄](https://indexes.nikkei.co.jp/nkave/index/component?idx=nk225)）。J-Quantsは「225採用か否か」は持ちません。
- **業種・銘柄名**：J-Quantsの `/listed/info` が `Sector33CodeName`（例: 電気機器 / 情報・通信業）を返すので、コードさえ正しければ自動補完可能。
- **PAF（株価換算係数）**：大半は1。値がさ株のみ0.1〜0.9（日経 Premium Data Package が公式。数銘柄の手当てでも実用精度）。
- **除数**：日経が日次公表（現在 ≈ 29.92）。`index-params.json` の `divisor` を更新。

```bash
node server/build-params.mjs   # index-params.json を生成（現状は data/ni225.js 由来）
```

## デプロイ先について

Cloudflare Workers を例にしていますが、Vercel Edge / AWS Lambda 等でも
`export default { fetch }` を各ランタイムのハンドラに合わせれば流用できます。
