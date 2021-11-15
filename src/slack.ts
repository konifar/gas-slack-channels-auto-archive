const SLACK_API_URL = "https://slack.com/api";

const SLACK_TOKEN =
  PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");
const SPREAD_SHEET_ID =
  PropertiesService.getScriptProperties().getProperty("SPREAD_SHEET_ID");

const SHEET_NAME_LIST = "list";
const SHEET_NAME_PRE_ARCHIVE_LIST = "pre_ archive_list";

const WARNING_DAYS_COUNT = 90;

function execute() {
  const channels = getPublicChannels();
  Logger.log(`Number of all channels: ${channels.length}`);

  const users = getAllUsers();
  Logger.log(`Number of all users: ${users.size}`);

  const sheetRowData: Array<AllListSheetRow> = []; // Array to output to SpreadSheet

  for (const channel of channels) {
    if (!channel.is_channel) {
      continue;
    }

    const latestMessage = getLatestChannelMessage(channel.id);
    const creatorName = users.get(channel.creator);

    Logger.log(`  - Channel:#${channel.name}, Creator:@${creatorName}`);

    if (latestMessage != null) {
      // Calculate days diff from the last message date to the current date
      const row = createSheetRow(
        channel,
        creatorName,
        users.get(latestMessage.user),
        latestMessage.ts,
        latestMessage.text,
        latestMessage.ts
      );
      sheetRowData.push(row);
    } else {
      // Calculate days diff from the channel created date to the current date
      const row = createSheetRow(
        channel,
        creatorName,
        "",
        channel.created,
        "",
        0
      );
      sheetRowData.push(row);
    }
  }

  writeAllListToSpreadSheet(sheetRowData);
  Logger.log(`Write all list to SpreadSheet: ${sheetRowData.length}`);

  const preArchiveMap = readPreArchiveMapFromSpreadSheet();
  Logger.log(`Get previous pre archive list: ${preArchiveMap.size}`);

  const preArchiveRowData = createPreArchiveSheetRows(
    sheetRowData,
    preArchiveMap
  );
  whitePreArchiveListToSpreadSheet(preArchiveRowData);
  Logger.log(
    `Write pre archive list to SpreadSheet: ${preArchiveRowData.length}`
  );
}

/**
 * @return SpreadSheet row data array
 */
function createSheetRow(
  channel: any,
  creatorName: any,
  lastUserName: any,
  lastTs: number,
  lastMessageText: string,
  lastMessageTs: number
): AllListSheetRow {
  const elapsedDays = Math.floor(
    (new Date().getTime() - new Date(lastTs * 1000).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const lastMessageDate =
    lastMessageTs > 0 ? formatDateYYYYMMddHHmmss(lastMessageTs) : "";
  const wl = isWhitelisted(channel);
  return new AllListSheetRow(
    channel.name,
    channel.id,
    creatorName,
    formatDateYYYYMMddHHmmss(channel.created),
    channel.num_members,
    lastUserName,
    lastMessageText,
    lastMessageDate,
    elapsedDays,
    wl
  );
}

/**
 * @return Array of all public channels
 */
function getPublicChannels(): Array<any> {
  let channels: Array<any> = [];
  let nextCursor = "";

  do {
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
 * @return Map of user id and user name
 */
function getAllUsers(): Map<string, string> {
  const usersMap = new Map<string, string>();
  let nextCursor = "";

  do {
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

function writeAllListToSpreadSheet(rowData: Array<AllListSheetRow>) {
  if (SPREAD_SHEET_ID == null) {
    return;
  }

  const sheet =
    SpreadsheetApp.openById(SPREAD_SHEET_ID).getSheetByName(SHEET_NAME_LIST);
  if (sheet == null) {
    Logger.log(`SpreadSheet is not found: ${SPREAD_SHEET_ID}`);
    return;
  }

  if (rowData.length == 0) {
    Logger.log("Data is empty");
    return;
  }

  // Clear data
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
 * @return Map of pairs of channel_id and created_at
 */
function readPreArchiveMapFromSpreadSheet(): Map<string, Date> {
  if (SPREAD_SHEET_ID == null) {
    Logger.log(`SpreadSheet is not found: ${SPREAD_SHEET_ID}`);
    return new Map();
  }

  const sheet = SpreadsheetApp.openById(SPREAD_SHEET_ID).getSheetByName(
    SHEET_NAME_PRE_ARCHIVE_LIST
  );
  if (sheet == null) {
    Logger.log(`Sheet is not found: ${SHEET_NAME_PRE_ARCHIVE_LIST}`);
    return new Map();
  }

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
 * @return Current data rows to be listed to pre-archive
 */
function createPreArchiveSheetRows(
  rowData: Array<AllListSheetRow>,
  currentPreArchiveMap: Map<string, Date>
): Array<PreArchiveListSheetRow> {
  if (rowData.length == 0) {
    Logger.log("Data is empty");
    return [];
  }

  const result = [];

  for (const row of rowData) {
    if (row.elapsedDays >= WARNING_DAYS_COUNT && !row.isWhitelist) {
      let listedAt = currentPreArchiveMap.get(row.channelID);
      if (listedAt == null) {
        listedAt = new Date();
      }

      const daysFromListed = Math.floor(
        (new Date().getTime() - listedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      result.push(
        new PreArchiveListSheetRow(
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

function whitePreArchiveListToSpreadSheet(
  rowData: Array<PreArchiveListSheetRow>
) {
  if (SPREAD_SHEET_ID == null) {
    return;
  }

  const sheet = SpreadsheetApp.openById(SPREAD_SHEET_ID).getSheetByName(
    SHEET_NAME_PRE_ARCHIVE_LIST
  );
  if (sheet == null) {
    return;
  }

  if (rowData.length == 0) {
    Logger.log("Data is empty");
    return;
  }

  // Clear data
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
    { column: 6, ascending: false },
    { column: 4, ascending: false },
  ]);
  sheet.setRowHeights(2, rows - 1, 21);
}

/**
 * @return Latest message of the last 200 messages
 */
function getLatestChannelMessage(channelId: string) {
  const url = `${SLACK_API_URL}/conversations.history?token=${SLACK_TOKEN}&channel=${channelId}&limit=200`;
  const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());

  for (const message of json.messages) {
    // https://api.slack.com/events/message#subtypes
    if (
      message.type == "message" &&
      message.subtype != "channel_leave" &&
      message.subtype != "channel_join"
    ) {
      return message;
    }
  }
  return null;
}

/**
 * @return Formatted date string
 */
function formatDateYYYYMMddHHmmss(timestamp: number): string {
  return Utilities.formatDate(
    new Date(timestamp * 1000),
    "Asia/Tokyo",
    "yyyy/MM/dd HH:mm:ss"
  );
}

function isWhitelisted(channel: any): boolean {
  return (
    channel.purpose.value.includes(":keep:") || channel.name.includes("alert")
  );
}

class AllListSheetRow {
  channelName: string; // チャネル名
  channelID: string; // チャネルID
  creatorName: string; // 作成ユーザー
  channelCreatedDate: string; // 作成日時
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
      this.lastUserName,
      this.lastMessageText,
      this.lastMessageDate,
      this.elapsedDays,
      this.isWhitelist,
    ];
  }
}

class PreArchiveListSheetRow {
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
