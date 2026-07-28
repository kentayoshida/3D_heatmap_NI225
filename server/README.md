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

## 指数パラメータ（`index-params.json`）の作り方

**推奨パイプライン**（公式CSV → build → J-Quants補完）:

```bash
# 1) 公式の PAF CSV をダウンロードして server/ に置く（225銘柄コード＋PAF＝権威データ）
#    https://indexes.nikkei.co.jp/nkave/archives/file/nikkei_225_price_adjustment_factor_jp.csv
curl -L -o server/nikkei_225_price_adjustment_factor_jp.csv \
  https://indexes.nikkei.co.jp/nkave/archives/file/nikkei_225_price_adjustment_factor_jp.csv

# 2) CSV から index-params.json を生成（コード＋PAF。CSVが無ければ候補リストにフォールバック）
node server/build-params.mjs

# 3) 銘柄名・業種を J-Quants /listed/info の権威データで補完（未採用/廃止コードは警告）
JQUANTS_REFRESH_TOKEN=... node server/enrich-params.mjs
```

- **銘柄コード＋採用可否＋PAF**：公式PAF CSV（上記）。日経が保有し、J-Quantsは「225採用か否か」を持ちません。CSVパーサはエンコーディング非依存でコードとPAFのみ抽出します。
- **業種・銘柄名**：J-Quants `/listed/info` の `Sector33CodeName` / `CompanyName` で自動補完（`enrich-params.mjs`）。
- **PAF（株価換算係数）**：大半は1。値がさ株のみ0.1〜0.9。CSVから取り込み。
- **除数（Divisor）**：日経が日次公表（現在 ≈ 29.92）。[指数情報ページ](https://indexes.nikkei.co.jp/nkave/index/profile)で確認し、`build-params.mjs` の `DIVISOR` を更新。

> CSVを置かない場合は `server/constituents.mjs`（手動編集の候補リスト）にフォールバックします。
> これは検証用のスーパーセット（現在245件）で、正確な225の確定にはCSVが必要です。

## デプロイ先について

Cloudflare Workers を例にしていますが、Vercel Edge / AWS Lambda 等でも
`export default { fetch }` を各ランタイムのハンドラに合わせれば流用できます。
