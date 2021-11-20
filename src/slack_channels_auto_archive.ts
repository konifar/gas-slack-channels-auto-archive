import Sheet = GoogleAppsScript.Spreadsheet.Sheet;

const SLACK_API_URL = "https://slack.com/api";

const SLACK_TOKEN = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");
// アーカイブを行うSlack BotのToken
const SLACK_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty("SLACK_BOT_TOKEN");
// アーカイブを行うSlack Botをチャネルに招待する時に使うユーザーID
const SLACK_BOT_USER_ID = PropertiesService.getScriptProperties().getProperty("SLACK_BOT_USER_ID");
// 結果をコメントするSlack Botの表示名
const SLACK_BOT_NAME = PropertiesService.getScriptProperties().getProperty("SLACK_BOT_NAME");
// 結果をコメントするSlack Botのアイコンemoji
const SLACK_BOT_ICON_EMOJI = PropertiesService.getScriptProperties().getProperty("SLACK_BOT_ICON_EMOJI");

const ANNOUNCE_SLACK_CHANNEL_ID = PropertiesService.getScriptProperties().getProperty("ANNOUNCE_SLACK_CHANNEL_ID");

const SPREAD_SHEET_ID = PropertiesService.getScriptProperties().getProperty("SPREAD_SHEET_ID");
const SHEET_NAME_PUBLIC_CHANNELS = "public_channels";
const SHEET_NAME_ARCHIVE_WARNING_CHANNELS = "archive_warning_channels";

// アーカイブ警告を行う閾値の日数
const WARNING_DAYS_COUNT = 95;
// アーカイブを行うまでの最大警告日数
const GRACE_DAYS_COUNT = 5;

function execute() {
  const channels = fetchPublicChannels();
  Logger.log(`Publicチャネル数: ${channels.length}`);

  const usersMap = fetchAllUserIdNameMap();
  Logger.log(`ユーザー数: ${usersMap.size}`);

  const allChannelsRowList: Array<AllPublicChannelsSheetRow> = [];
  for (const channel of channels) {
    if (!channel.is_channel) {
      continue;
    }
    const latestMessage = fetchLatestChannelMessage(channel.id);
    const row = createAllPublicChannelsSheetRow(channel, usersMap, latestMessage);
    const creatorName = row.creatorName != "" ? `@${row.creatorName}` : "不明";
    Logger.log(`  [#${row.channelName}] 作成者: ${creatorName}`);
    allChannelsRowList.push(row);
  }

  if (allChannelsRowList.length == 0) {
    Logger.log("Publicチャネルがありません");
    return;
  }

  writeAllPublicChannelsToSpreadSheet(allChannelsRowList);

  const archiveWarningChannelsMap = readArchiveWarningChannelsMapFromSpreadSheet();
  Logger.log(`現在のアーカイブ警告チャネル数: ${archiveWarningChannelsMap.size}`);

  const archiveWarningRows = createArchiveWarningChannelSheetRows(allChannelsRowList, archiveWarningChannelsMap);
  writeArchiveWarningChannelsToSpreadSheet(archiveWarningRows);
  Logger.log(`アーカイブ警告チャネルをSpreadSheetに書き込み: ${archiveWarningRows.length}`);

  const archivedRows = archiveChannels(archiveWarningRows);
  Logger.log(`アーカイブしたチャネル数: ${archivedRows.length}`);

  const slackMessage = createSlackMessage(archivedRows, archiveWarningRows);
  Logger.log(slackMessage);

  if (ANNOUNCE_SLACK_CHANNEL_ID != null) {
    postSlackBotMessage(ANNOUNCE_SLACK_CHANNEL_ID, slackMessage);
  }
}

/**
 * @return Publicチャネル一覧のSpreadSheetのRow
 */
function createAllPublicChannelsSheetRow(channel: any, usersMap: any, latestMessage: any): AllPublicChannelsSheetRow {
  const creatorName = usersMap.get(channel.creator) != undefined ? usersMap.get(channel.creator) : "";
  const lastTs = latestMessage != null ? latestMessage.ts : channel.created;
  const lastUserName = latestMessage != null ? (usersMap.get(latestMessage.user) != undefined ? usersMap.get(latestMessage.user) : "") : "";
  const lastMessageText = latestMessage != null ? latestMessage.text : "";
  const lastMessageTs = latestMessage != null ? latestMessage.ts : 0;

  const lastMessageDate = lastMessageTs > 0 ? formatDateYYYYMMddHHmmss(lastMessageTs) : "";
  const elapsedDays = Math.floor((new Date().getTime() - new Date(lastTs * 1000).getTime()) / (1000 * 60 * 60 * 24));

  return new AllPublicChannelsSheetRow(
    channel.name,
    channel.id,
    creatorName,
    formatDateYYYYMMddHHmmss(channel.created),
    channel.num_members,
    channel.is_shared,
    lastUserName,
    lastMessageText,
    lastMessageDate,
    elapsedDays,
    isWhitelisted()
  );

  /**
   * アーカイブ対象にしないチャネルのルール
   * ここでは例として次のルールを設定してあります
   *   1. チャネルのDesicriptionに :keep: emojiが設定されている
   *   2. チャネル名に alert が含まれる
   *   3. 共有チャネルである
   */
  function isWhitelisted(): boolean {
    return channel.purpose.value.includes(":keep:") || channel.name.includes("alert") || channel.is_shared == "true"; // eslint-disable-line @typescript-eslint/naming-convention
  }
}

/**
 * @return Publicチャネル一覧
 */
function fetchPublicChannels(): Array<any> {
  let channels: Array<any> = [];
  let nextCursor = "";

  do {
    // https://api.slack.com/methods/conversations.list
    let url = `${SLACK_API_URL}/conversations.list?token=${SLACK_TOKEN}&exclude_archived=true&types=public_channel&limit=999`;
    if (nextCursor != "") {
      url += `&cursor=${nextCursor}`;
    }
    const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());
    channels = channels.concat(json.channels);
    nextCursor = json.response_metadata.next_cursor;
  } while (nextCursor != "");

  return channels;
}

/**
 * @return ユーザーIDとユーザー名のMap
 */
function fetchAllUserIdNameMap(): Map<string, string> {
  const usersMap = new Map<string, string>();
  let nextCursor = "";

  do {
    // https://api.slack.com/methods/users.list
    let url = `${SLACK_API_URL}/users.list?token=${SLACK_TOKEN}&limit=999`;
    if (nextCursor != "") {
      url += `&cursor=${nextCursor}`;
    }
    const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());
    for (const member of json.members) {
      usersMap.set(member.id, member.name);
    }
    nextCursor = json.response_metadata.next_cursor;
  } while (nextCursor != "");

  return usersMap;
}

/**
 * Publicチャネル一覧をシートに書き込み
 */
function writeAllPublicChannelsToSpreadSheet(rowData: Array<AllPublicChannelsSheetRow>) {
  const sheet = getSheet(SHEET_NAME_PUBLIC_CHANNELS);

  sheet.getRange("A2:I3000").clearContent();

  const rowArrays = rowData.map(function (row) {
    return row.toArray();
  });

  const rows = rowArrays.length;
  const cols = rowArrays[0] != null ? rowArrays[0].length : 0;
  const range = sheet.getRange(2, 1, rows, cols);
  range.setValues(rowArrays);
  // Order by elapsed date desc
  range.sort([
    { column: 9, ascending: false },
    { column: 1, ascending: true },
  ]);
  sheet.setRowHeights(2, rows - 1, 21);
}

/**
 * @return 現在のチャネルIDと追加日のMap
 */
function readArchiveWarningChannelsMapFromSpreadSheet(): Map<string, Date> {
  const sheet = getSheet(SHEET_NAME_ARCHIVE_WARNING_CHANNELS);

  const values = sheet.getDataRange().getValues();

  const result = new Map<string, Date>();
  for (let i = 1; i < values.length; i++) {
    const value = values[i];
    if (value != undefined) {
      const channelID = value[1];
      const date = value[5];
      if (date.constructor.name == "Date") {
        result.set(channelID, date);
      }
    }
  }
  return result;
}

/**
 * @return アーカイブ警告チャネル一覧
 */
function createArchiveWarningChannelSheetRows(
  allChannelsRows: Array<AllPublicChannelsSheetRow>,
  currentArchiveWarningChannelIdDateMap: Map<string, Date>
): Array<ArchiveWarningChannelsSheetRow> {
  const result = [];

  for (const row of allChannelsRows) {
    if (row.elapsedDays >= WARNING_DAYS_COUNT && !row.isWhitelist) {
      let listedAt = currentArchiveWarningChannelIdDateMap.get(row.channelID);
      if (listedAt == null || listedAt == undefined) {
        listedAt = new Date();
      }

      const daysFromListed = Math.floor((new Date().getTime() - listedAt.getTime()) / (1000 * 60 * 60 * 24));

      result.push(
        new ArchiveWarningChannelsSheetRow(
          row.channelName,
          row.channelID,
          row.creatorName,
          row.lastUserName,
          row.elapsedDays,
          listedAt,
          daysFromListed
        )
      );
    }
  }

  return result;
}

/**
 * @return 引数のシート名のSheet
 */
function getSheet(sheetName: string): Sheet {
  if (SPREAD_SHEET_ID == null) {
    throw new Error(`SpreadSheet is not found: ${SPREAD_SHEET_ID}`);
  }
  const sheet = SpreadsheetApp.openById(SPREAD_SHEET_ID).getSheetByName(sheetName);
  if (sheet == null) {
    throw new Error(`Sheet is not found: ${sheetName}`);
  }
  return sheet;
}

/**
 * アーカイブ警告チャネル一覧の書き込み
 */
function writeArchiveWarningChannelsToSpreadSheet(rowData: Array<ArchiveWarningChannelsSheetRow>) {
  const sheet = getSheet(SHEET_NAME_ARCHIVE_WARNING_CHANNELS);

  sheet.getRange("A2:I3000").clearContent();

  const rowArrays = rowData.map(function (row) {
    return row.toArray();
  });
  const rows = rowArrays.length;
  const cols = rowArrays[0] != null ? rowArrays[0].length : 0;
  const range = sheet.getRange(2, 1, rows, cols);
  range.setValues(rowArrays);
  // Order by listed date and elapsed date desc
  range.sort([
    { column: 7, ascending: false },
    { column: 1, ascending: true },
  ]);
  sheet.setRowHeights(2, rows - 1, 21);
}

/**
 * 警告から${GRACE_DAYS_COUNT}日以上経ったチャネルをアーカイブ
 * @return アーカイブしたチャネル行リスト
 */
function archiveChannels(rowData: Array<ArchiveWarningChannelsSheetRow>): Array<ArchiveWarningChannelsSheetRow> {
  const archiveTargets = rowData.filter(function (row) {
    return row.daysFromListed >= GRACE_DAYS_COUNT;
  });

  const result = [];
  for (const target of archiveTargets) {
    // チャネルに参加していないとアーカイブできないので招待しておく
    const invited = inviteBotToChannel(target.channelID);
    Logger.log(`  [${target.channelName}] invited: ${invited}`);
    const archived = archiveChannel(target.channelID);
    Logger.log(`  [${target.channelName}] archived: ${archived}`);
    if (archived) {
      result.push(target);
    }
  }
  return result;
}

/**
 * @return Slackに通知するメッセージ
 */
function createSlackMessage(archivedRows: Array<ArchiveWarningChannelsSheetRow>, archiveWarningRows: Array<ArchiveWarningChannelsSheetRow>): string {
  const filteredArchiveWarningRows = archiveWarningRows
    .sort(function (a, b) {
      if (a.daysFromListed > b.daysFromListed) {
        return -1;
      } else if (a.daysFromListed < b.daysFromListed) {
        return 1;
      } else {
        if (a.channelName < b.channelName) {
          return -1;
        } else if (a.channelName > b.channelName) {
          return 1;
        } else {
          return 0;
        }
      }
    })
    .filter(function (row) {
      return !archivedRows.includes(row);
    });

  const sortedArchivedRows = archivedRows.sort(function (a, b) {
    if (a.channelName < b.channelName) {
      return -1;
    } else if (a.channelName > b.channelName) {
      return 1;
    } else {
      return 0;
    }
  });

  const sheet = getSheet(SHEET_NAME_ARCHIVE_WARNING_CHANNELS);
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SPREAD_SHEET_ID}/edit#gid=${sheet.getSheetId()}`;

  let message = "";
  if (sortedArchivedRows.length > 0) {
    message += `*:wave: ${sortedArchivedRows.length} 件のチャネルが、警告から ${GRACE_DAYS_COUNT}日 以上コメントがなかったためアーカイブされました*\n\n`;
    for (const row of sortedArchivedRows) {
      const creatorName = row.creatorName != "" ? `@${row.creatorName}` : "不明";
      message += `#${row.channelName} by ${creatorName}\n`;
    }
    if (filteredArchiveWarningRows.length > 0) {
      message += "\n\n\n";
    }
  }

  if (filteredArchiveWarningRows.length > 0) {
    message += `*:hourglass_flowing_sand: ${filteredArchiveWarningRows.length}件 のチャネルが、${WARNING_DAYS_COUNT}日 以上コメントがないため自動アーカイブの候補になっています*\n`;
    message += `アーカイブしてもよい場合はアーカイブしましょう！\n`;
    message += `アーカイブされたくない場合は何かコメントするか、チャネルDescriptionに :keep: を入れてください :pray:\n`;
    message += `${sheetUrl}\n\n`;
    for (const row of filteredArchiveWarningRows) {
      const remainingDays = GRACE_DAYS_COUNT - row.daysFromListed;
      if (remainingDays > 0) {
        const creatorName = row.creatorName != "" ? `@${row.creatorName}` : "不明";
        message += `\`あと ${remainingDays} 日\` #${row.channelName} by ${creatorName}\n`;
      }
    }
  }

  return message;
}

/**
 * 直近200件の中で最新のチャネルメッセージを取得
 * @return 最新のメッセージ
 */
function fetchLatestChannelMessage(channelId: string): any {
  // https://api.slack.com/methods/conversations.history
  const url = `${SLACK_API_URL}/conversations.history?token=${SLACK_TOKEN}&channel=${channelId}&limit=200`;
  const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());

  for (const message of json.messages) {
    // https://api.slack.com/events/message#subtypes
    if (message.type == "message" && message.subtype != "channel_leave" && message.subtype != "channel_join") {
      return message;
    }
  }
  return null;
}

/**
 * 引数のチャネルをアーカイブ
 * @return 成功したらtrue
 */
function archiveChannel(channelId: string): boolean {
  // https://api.slack.com/methods/conversations.archive
  const url = `${SLACK_API_URL}/conversations.archive`;
  const body = {
    token: SLACK_BOT_TOKEN,
    channel: channelId,
  };
  const headers = {
    Authorization: `Bearer ${SLACK_TOKEN}`,
  };
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    headers: headers,
    muteHttpExceptions: true,
  });

  const json = JSON.parse(res.getContentText());
  return json.ok;
}

/**
 * 引数のチャネルにBotユーザーを招待
 * @return 成功したらtrue
 */
function inviteBotToChannel(channelId: string): boolean {
  // https://api.slack.com/methods/conversations.invite
  const url = `${SLACK_API_URL}/conversations.invite`;
  const body = {
    token: SLACK_TOKEN,
    channel: channelId,
    users: SLACK_BOT_USER_ID,
  };
  const headers = {
    Authorization: `Bearer ${SLACK_TOKEN}`,
  };
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    headers: headers,
    muteHttpExceptions: true,
  });

  const json = JSON.parse(res.getContentText());
  return json.ok;
}

/**
 * Slackにコメント
 */
function postSlackBotMessage(channelId: string, text: string): boolean {
  if (text == "") {
    return false;
  }
  // https://api.slack.com/methods/chat.postMessage
  const url = `${SLACK_API_URL}/chat.postMessage`;
  const body = {
    token: SLACK_BOT_TOKEN,
    channel: channelId,
    text: text,
    icon_emoji: SLACK_BOT_ICON_EMOJI, // eslint-disable-line @typescript-eslint/naming-convention
    username: SLACK_BOT_NAME,
    link_names: true, // eslint-disable-line @typescript-eslint/naming-convention
  };
  const headers = {
    Authorization: `Bearer ${SLACK_TOKEN}`,
  };
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    headers: headers,
    muteHttpExceptions: true,
  });

  const json = JSON.parse(res.getContentText());
  return json.ok;
}

/**
 * timestampをSpreadSheetに表示する時刻形式に変換
 * @return 変換された時刻String
 */
function formatDateYYYYMMddHHmmss(timestamp: number): string {
  return Utilities.formatDate(new Date(timestamp * 1000), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}

class AllPublicChannelsSheetRow {
  channelName: string; // チャネル名
  channelID: string; // チャネルID
  creatorName: string; // 作成ユーザー
  channelCreatedDate: string; // 作成日時
  channelIsShared: boolean; // 共有チャネル
  channelNumMembers: number; // ユーザー数
  lastUserName: string; // 最新コメントユーザー
  lastMessageText: string; // 最新コメント
  lastMessageDate: string; // 最新コメント日時
  elapsedDays: number; // 最新コメントからの日数
  isWhitelist: boolean; // Whitelist

  constructor(
    channelName: string,
    channelID: string,
    creatorName: string,
    channelCreatedDate: string,
    channelNumMembers: number,
    channelIsShared: boolean,
    lastUserName: string,
    lastMessageText: string,
    lastMessageDate: string,
    elapsedDays: number,
    isWhitelist: boolean
  ) {
    this.channelName = channelName;
    this.channelID = channelID;
    this.creatorName = creatorName;
    this.channelCreatedDate = channelCreatedDate;
    this.channelNumMembers = channelNumMembers;
    this.channelIsShared = channelIsShared;
    this.lastUserName = lastUserName;
    this.lastMessageText = lastMessageText;
    this.lastMessageDate = lastMessageDate;
    this.elapsedDays = elapsedDays;
    this.isWhitelist = isWhitelist;
  }

  toArray(): Array<any> {
    return [
      this.channelName,
      this.channelID,
      this.creatorName,
      this.channelCreatedDate,
      this.channelNumMembers,
      this.channelIsShared,
      this.lastUserName,
      this.lastMessageText,
      this.lastMessageDate,
      this.elapsedDays,
      this.isWhitelist,
    ];
  }
}

class ArchiveWarningChannelsSheetRow {
  channelName: string; // チャネル名
  channelID: string; // チャネルID
  creatorName: string; // 作成ユーザー
  lastUserName: string; // 最新コメントユーザー
  elapsedDays: number; // 最新コメントからの日数
  listedAt: Date; // 追加日
  daysFromListed: number; // 追加日からの日数

  constructor(
    channelName: string,
    channelID: string,
    creatorName: string,
    lastUserName: string,
    elapsedDays: number,
    listedAt: Date,
    daysFromListed: number
  ) {
    this.channelName = channelName;
    this.channelID = channelID;
    this.creatorName = creatorName;
    this.lastUserName = lastUserName;
    this.elapsedDays = elapsedDays;
    this.listedAt = listedAt;
    this.daysFromListed = daysFromListed;
  }

  toArray(): Array<any> {
    return [
      this.channelName,
      this.channelID,
      this.creatorName,
      this.lastUserName,
      this.elapsedDays,
      formatDateYYYYMMddHHmmss(this.listedAt.getTime() / 1000),
      this.daysFromListed,
    ];
  }
}
