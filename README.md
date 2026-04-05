# NotebookLM Prompt Generator

article番号を入力するだけで見出しを自動取得し、10〜15枚に収まるよう自動グループ分けして、NotebookLMに貼り付けるプロンプトを出力するツールです。

## 機能

- 📰 article番号からRSS/OGP経由で見出しを自動取得
- 📑 10〜15枚のスライドに収まるよう自動グループ分け
- 📋 NotebookLM用プロンプトをそのまま出力（コピー可能）
- 🌐 ブラウザだけで動作（インストール不要）

## 使い方

1. `index.html` をブラウザで開く（またはGitHub Pagesにアクセス）
2. article番号またはURLを入力
3. 「取得する」ボタンをクリック
4. 生成されたプロンプトをコピーしてNotebookLMに貼り付け

## 対応メディア

| メディア | 入力形式 |
|---|---|
| note.com | article番号 or URL |
| Qiita | article ID or URL |
| Zenn | slug or URL |
| 任意URL | URL直接入力 |

## ローカル実行

```bash
git clone https://github.com/werisupp/notebooklm-prompt-generator.git
cd notebooklm-prompt-generator
# index.html をブラウザで開くだけでOK
```

## ライセンス

MIT
