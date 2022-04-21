# gas-slack-channels-auto-archive
『100日後にアーカイブされるSlackチャネル』を動かすGoogle Apps Script

[![clasp](https://img.shields.io/badge/built%20with-clasp-4285f4.svg)](https://github.com/google/clasp)
![deploy workflow](https://github.com/konifar/gas-slack-channels-auto-archive/actions/workflows/deploy.yml/badge.svg)

## Script Overview

1. SlackのPublicチャネル一覧を取得し、[public_channelsシート](https://docs.google.com/spreadsheets/d/1OJ4wi8GfFVh6a-rof14752RK9UOtLeoJAr26_yQo7m0/edit#gid=0)に記載します
2. 95日以上コメントのないチャネル一覧を[archive_warning_channelsシート](https://docs.google.com/spreadsheets/d/1OJ4wi8GfFVh6a-rof14752RK9UOtLeoJAr26_yQo7m0/edit#gid=713093396)に記載します
3. [archive_warning_channelsシート](https://docs.google.com/spreadsheets/d/1OJ4wi8GfFVh6a-rof14752RK9UOtLeoJAr26_yQo7m0/edit#gid=713093396)に記載されてから5日以上経ったチャネルを自動でアーカイブします

## Setup

詳細は [google/clasp](https://github.com/google/clasp) を参照してください。

```shell
# After fork & clone
cd gas-slack-channels-auto-archive
npm install -g @google/clasp
clasp create --type standalone
yarn install
```

## GitHub Secrets

デプロイに必要な `~/.clasprc.json` の情報をGitHubリポジトリのSecretsに登録します。

- `CLASPRC_ACCESS_TOKEN`
- `CLASPRC_CLIENT_ID`
- `CLASPRC_CLIENT_SECRET`
- `CLASPRC_EXPIRY_DATE`
- `CLASPRC_ID_TOKEN`
- `CLASPRC_REFRESH_TOKEN`

`clasp create` で生成される `.clasp.json` の情報も同様に登録します。 

- `CLASP_SCRIPT_ID`

### Script properties

Apps Scriptの中で参照する値をPropertiesに設定します。設定箇所は『GAS プロパティ 設定』などで検索してください。

Name | Description | Example
:-- | :-- | :--
SLACK_TOKEN | Slack APIを利用するためのToken。ユーザーの招待を行える権限が必要です | xoxp-3241341353-13423423423-234253515315-91f5d9c4an64ddd7535e6edf1c3126aa
SLACK_BOT_TOKEN | アーカイブを行うSlack BotのToken。チャネルのアーカイブを行える権限が必要です | xoxb-33554526158-2357340024131-qGIP1234DjYShIHGOERJRfF5AB
SLACK_BOT_USER_ID | アーカイブを行うSlack BotのユーザーID。チャネルに招待する時に使います | U02O7A02DQB
SLACK_BOT_NAME | 結果をコメントするSlack Botの表示名 | 100日後にアーカイブされるSlackチャネル
SLACK_BOT_ICON_EMOJI | 結果をコメントするSlack Botのアイコンemoji | :100wani:
ANNOUNCE_SLACK_CHANNEL_ID | 結果をコメントするSlackチャネル | BDI2O8BAL
SPREAD_SHEET_ID | 結果を記載するSpreadSheetのID | 1OJ4wi8GfFVh6a-rof14752RK9UOtLeoJAr26_yQo7m0

## Slack APIs

スクリプトでは、次のSlack APIを利用しています。

- https://api.slack.com/methods/conversations.list
- https://api.slack.com/methods/users.list
- https://api.slack.com/methods/conversations.history
- https://api.slack.com/methods/conversations.archive
- https://api.slack.com/methods/conversations.invite
- https://api.slack.com/methods/chat.postMessage
