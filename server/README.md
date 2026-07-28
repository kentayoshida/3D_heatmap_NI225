# サーバーレス・データプロキシ（JPX → 寄与度）

フロントエンドはブラウザからJPXの有料APIを直接呼べません（認証・CORS）。この
プロキシがAPIキーを保持し、JPXの株価から**寄与度**を計算して、フロントが期待する
JSON（全7期間）を返します。

```
JPX API (株価) ──▶ このWorker（寄与度を計算）──▶ フロント (js/data-source.js)
                    ▲ index-params.json（銘柄・業種・PAF・除数）
```

## 実装状況

- ✅ 変換ロジック（`worker.js` の `shapePeriod` / 寄与度計算）
- ✅ 指数パラメータ（`index-params.json`：銘柄・業種・PAF・除数のシード）
- ✅ CORS・キャッシュ・全7期間の並列取得
- ⬜ **`fetchPeriodPrices()`**（`worker.js` 内）= JPX API 呼び出し本体。
  JPXのエンドポイント／認証／レスポンス仕様をもとに実装します（**要・仕様共有**）。

## 寄与度の計算

```
騰落率(%)  = (close − base) / base × 100
寄与度     = PAF × (close − base) / 除数        （指数ポイント）
```

- `close` = 期間終点の価格（現在値／最新終値）
- `base`  = 期間始点の価格（1D=前日終値、1W=約5営業日前、YTD=前年末 …）
- `PAF`   = 株価換算係数（大半は1。値がさ株のみ0.1〜0.9）
- 除数    = 日経公表値（現在 ≈ 29.92）

## デプロイ（Cloudflare Workers 例）

```bash
npm i -g wrangler
wrangler secret put JPX_API_KEY        # JPXのAPIキーを登録
# 必要に応じて JPX_BASE_URL / ALLOW_ORIGIN を wrangler.toml の [vars] に設定
wrangler deploy
```

デプロイ後、フロントの `js/data-source.js` を設定:

```js
export const CONFIG = { endpoint: 'https://<your-worker>.workers.dev' };
```

## 指数パラメータの更新

`index-params.json` はサンプル由来の**シード**です。本番前に公式値へ差し替えます。

```bash
node server/build-params.mjs   # 現状は data/ni225.js から生成（要・公式データ差し替え）
```

- 銘柄・業種：日経平均プロフィル 構成銘柄（無料）
- PAF・ウエート：日経 Premium Data Package（有料）／値がさ株のみ手当てでも実用可
- 除数：日経が日次公表（≈ 29.92、変動する）
