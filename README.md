# MKQ物販集計

前野健太MKQツアーの物販を、公演ごとの在庫の前後カウント（販売前個数・販売後個数）から販売数・売上へ自動集計するツール。合言葉によるアクセス制限があり、保存データは共有データストア（Upstash Redis）に保存されるため、どの端末・どのブラウザからアクセスしても同じデータを参照できる。

## 仕組み

1. 公演（会場・日付）ごとに、Tシャツ・CDなどの品目を登録する（新しい公演を追加すると、直前の公演の品目リストがそのままコピーされる）
2. 各品目の「販売前個数」「販売後個数」を入力すると、販売数・売上がその場で自動計算される
3. 全公演を通した品目別の集計、公演別の売上一覧を確認でき、それぞれCSVで書き出せる
4. 入力データはブラウザの`localStorage`ではなく共有データストアに保存されるため、スタッフの誰がどの端末（PC・スマホ）から開いても同じデータを見られる

もともとはClaudeのアーティファクト機能（1枚のHTMLファイル）として作っていたが、Claudeアプリ内でのデータ消失や、iOSでローカルファイルをオフライン起動する際の制約（Quick LookはJavaScriptを実行しない）を根本的に解消するため、[map（Google Map Sorter）](../map/)と同じ構成（Next.js + Vercel + Upstash Redis + 合言葉ゲート）で作り直した。

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 合言葉ゲートの設定

ログイン不要のURLを他人が知っても使えないよう、アプリ全体を合言葉で保護している（Vercel純正のPassword Protectionは有料プランが必要なため、自前実装）。

1. 好きな合言葉を決める（`APP_PASSWORD`）
2. セッション署名用のランダム文字列を生成する

```bash
openssl rand -base64 32
```

### 3. 共有データストア（Upstash Redis）の準備

保存データはブラウザの`localStorage`ではなく、共有データストアに保存する。これにより複数端末（PC・スマホなど）からアクセスしても同じデータを参照できる。

1. [Upstash](https://upstash.com/)で無料アカウントを作成し、Redisデータベースを1つ作成する（この手順はユーザー自身で行う。すでにmapプロジェクト用に作成済みのデータベースがあれば、キー名が別（`mkqMerch:state`）なので同じデータベースを使い回しても問題ない）
2. データベースの詳細画面から「REST URL」と「REST Token」を控える
3. 個人利用の想定アクセス数（本番中の数十〜数百コマンド程度）は無料枠（月50万コマンド・256MB）に対して十分小さく、通常は追加課金は発生しない

### 4. 環境変数

`.env.example` を `.env.local` にコピーし、値を設定する。

```bash
cp .env.example .env.local
```

| 変数 | 説明 |
|---|---|
| `APP_PASSWORD` | アプリ全体を保護する合言葉 |
| `SESSION_SECRET` | セッションCookie署名用のランダム文字列（`openssl rand -base64 32`で生成） |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redisの接続情報 |

### 5. 開発サーバー起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開く。

## 本番デプロイ（Vercel）

1. このプロジェクトをGitHubリポジトリにする（`git init` → GitHubに新規リポジトリを作成してpush。mapプロジェクトとは別の、新しいリポジトリにする）
2. [Vercel](https://vercel.com/)で新規プロジェクトとしてそのリポジトリをインポートする
3. Vercelのプロジェクト設定 → 「Environment Variables」で、上記の環境変数（`APP_PASSWORD` / `SESSION_SECRET` / `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`）をすべて設定する
4. デプロイが終わると、`https://（プロジェクト名）.vercel.app` のようなURLが発行される。このURLをスタッフに共有し、初回アクセス時に合言葉を入力してもらう（以後30日間はそのブラウザで再入力不要）

## 技術構成

- Next.js（App Router）
- データ永続化: Upstash Redis（`@upstash/redis`、`lib/store.ts`）。キー`mkqMerch:state`に、公演一覧・品目・在庫入力をまとめたJSONを1つ保存する（複雑な差分マージはせず、保存のたびに全体を上書きする単純な方式）
- 認証: 合言葉ゲート（`lib/session.ts`）。`jose`でJWT署名したセッションをCookieに保存するステートレスセッション方式。`proxy.ts`（このNext.jsバージョンでの`middleware.ts`の後継）で未認証アクセスを`/login`にリダイレクトし、`app/api/state/route.ts`でも`verifySession()`により二重チェックする
- 画面本体（`public/mkq-app.js`）はReactを使わず、素のHTML/CSS/JavaScriptで実装している。もとのアーティファクト版（[MKQ-merch/index.html](../MKQ-merch/index.html)）と見た目・操作感を完全に揃えるため
