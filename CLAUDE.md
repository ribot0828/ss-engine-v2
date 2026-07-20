# ss-engine-v2

競馬の単勝特化予想AI。出馬表を取得→個別評価→期待値(EV)計算→クラス分類→推奨単勝を提示するWebアプリ。姉妹プロジェクトは `ss-analyzer`（バックテスト・解析側）。

## 構成
- `index.html` / `app.js` / `style.css` — フロントエンドUI（フェッチ・履歴・CSV出力）
- `logic.js` — コアロジック（`analyzeRace`, `SCORE_MAP`, `UNIT_TABLE`, クラス分類、`LOGIC_VERSION`）
- `scrape.py` / `api.js` — 出馬表スクレイピング（netkeiba）のPythonバックエンド
- `csv.js` / `history.js` / `xpost.js` — CSV出力・履歴保存・X投稿補助
- `vercel.json` — Vercelデプロイ設定（静的 + Python サーバーレス、`/api/index`→scrape.py）

## 制約・注意
- **現行仕様の正はこのリポジトリのコードではなく、Obsidianの `SS-Engine_v5.34_ロジック仕様書_2026-07-19.md`**（スコア〜仮説h13までの全量が1枚に集約されている、2026-07時点）。仕様の理解や変更判断はまずこのObsidianノートを確認すること。
- `logic.js` の `LOGIC_VERSION` がバージョンの正（2026-07時点 v5.34）。ロット・優先順位・MAO係数などのパラメータは頻繁に週次改善されるため、コード内コメントの日付を見て最新性を疑うこと。
- ユーザーはGitHub web上で直接コミットすることがある。ローカルクローンが古くなっている可能性が高いので、**編集前に必ず `git fetch` / `git log` で乖離を確認する**。
- **頻出の誤認注意**: `classPerformance.winRecoveryRate`（analyzer側の集計値）は「フラット買い」の診断値であり、実際の投資額に基づく回収率ではない。ここを実運用の成績と混同しないこと。
- CSVの単勝払戻列は2026-06-06を境にフォーマットが変わっている（レース単位の値 → `馬番: 金額円` 形式）。パース処理を触る際は analyzer.js 側の `parseColonPayout` 相当のロジックと整合させること。
- 資金管理・優先順位・ユニット配分などのパラメータ変更は、必ず ss-analyzer 側のバックテストで検証してから反映する運用。

## よくある作業
- ロジック（スコア・EV・クラス分類・優先順位・ユニット配分）の変更 → `logic.js` を見る。まずObsidian仕様書で現行値を確認。
- UI・表示・CSV出力・履歴の変更 → `app.js` / `index.html` / `style.css` / `csv.js` / `history.js`
- 出馬表取得・スクレイピング周りの変更 → `scrape.py` / `api.js`
- 週次のパラメータ改善サイクル（Gemini提案→査定→実装）に関わる依頼 → Obsidian `20_Projects/SS-Engine/Process/` の開発日誌群を先に確認
