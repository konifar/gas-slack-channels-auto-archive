const SLACK_API_URL = "https://slack.com/api";
const SLACK_TOKEN = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");
const SPREAD_SHEET_ID = PropertiesService.getScriptProperties().getProperty("SPREAD_SHEET_ID");

function execute() {
  const channels = getPublicChannels();
  Logger.log(`Number of all channels: ${channels.length}`);

  const users = getAllUsers();
  Logger.log(`Number of all users: ${users.size}`);

  const sheetRowData = []; // Array to output to SpreadSheet

  for (let channel of channels) {
    if (!channel.is_channel) {
      continue;
    }

    const latestMessage = getLatestChannelMessage(channel.id);
    const creatorName = users.get(channel.creator);

    Logger.log(`  - Channel:#${channel.name}, Creator:@${creatorName}`);

    if (latestMessage != null) {
      // Calculate days diff from the last message date to the current date
      const row = createSheetRow(channel, creatorName, users.get(latestMessage.user), latestMessage.ts, latestMessage.text, latestMessage.ts);
      sheetRowData.push(row);
    } else {
      // Calculate days diff from the channel created date to the current date
      const row = createSheetRow(channel, creatorName, "", channel.created, "", 0);
      sheetRowData.push(row.toArray());
    }
  }

  Logger.log(`Write data to SpreadSheet: ${sheetRowData.length}`);
  writeDataToSpreadSheet(sheetRowData);
}

/**
 * @return SpreadSheet row data array
 */
function createSheetRow(channel: any, creatorName: any, lastUserName: any, lastTs: number, lastMessageText: string, lastMessageTs: number): SheetRow {
  const ellapsedDays = Math.floor((new Date().getTime() - new Date(lastTs * 1000).getTime()) / (1000 * 60 * 60 * 24));
  const lastMessageDate = lastMessageTs > 0 ? formatDateYYYYMMddHHmmss(lastMessageTs) : "";
  return new SheetRow(
    channel.name,
    channel.id,
    creatorName,
    formatDateYYYYMMddHHmmss(channel.created),
    channel.num_members,
    lastUserName,
    lastMessageText,
    lastMessageDate,
    ellapsedDays,
  );
}

class SheetRow {
  channelName: string;
  channelID: string;
  creatorName: string;
  channelCreatedDate: string;
  channelNumMembers: number;
  lastUserName: string;
  lastMessageText: string;
  lastMessageDate: string;
  ellapsedDays: number;

  constructor(
    channelName: string,
    channelID: string,
    creatorName: string,
    channelCreatedDate: string,
    channelNumMembers: number,
    lastUserName: string,
    lastMessageText: string,
    lastMessageDate: string,
    ellapsedDays: number
  ) {
    this.channelName = channelName;
    this.channelID = channelID;
    this.creatorName = creatorName;
    this.channelCreatedDate = channelCreatedDate;
    this.channelNumMembers = channelNumMembers;
    this.lastUserName = lastUserName;
    this.lastMessageText = lastMessageText;
    this.lastMessageDate = lastMessageDate;
    this.ellapsedDays = ellapsedDays;
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
      this.ellapsedDays,
    ];
  }
}

/**
 * @return Array of all public channels
 */
function getPublicChannels(): Array<any> {
  let channels: any[] = [];
  let nextCursor = "";

  while (true) {
    let url = `${SLACK_API_URL}/conversations.list?token=${SLACK_TOKEN}&exclude_archived=true&types=public_channel&limit=999`;
    if (nextCursor != "") {
      url += `&cursor=${nextCursor}`
    }
    const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());
    channels = channels.concat(json.channels);
    if (json.response_metadata.next_cursor != "") {
      nextCursor = json.response_metadata.next_cursor;
      continue;
    }
    break;
  }

  return channels;
}

/**
 * @return Map of user id and user name
 */
function getAllUsers(): Map<String, String> {
  const usersMap = new Map<String, String>();
  let nextCursor = "";

  while (true) {
    let url = `${SLACK_API_URL}/users.list?token=${SLACK_TOKEN}&limit=999`;
    if (nextCursor != "") {
      url += `&cursor=${nextCursor}`
    }
    const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());
    for (let member of json.members) {
      usersMap.set(member.id, member.name);
    }
    if (json.response_metadata.next_cursor != "") {
      nextCursor = json.response_metadata.next_cursor;
      continue;
    }
    break;
  }
  return usersMap;
}

function writeDataToSpreadSheet(rowData: Array<any>) {
  if (SPREAD_SHEET_ID == null) {
    return;
  }

  const sheet = SpreadsheetApp.openById(SPREAD_SHEET_ID).getActiveSheet();
  if (sheet == null) {
    return;
  }

  if (rowData.length == 0) {
    Logger.log("Data is empty");
    return;
  }

  // Clear data
  sheet.getRange("A2:I1000").clearContent();

  const rows = rowData.length;
  const cols = rowData[0].length;
  const range = sheet.getRange(2, 1, rows, cols);
  range.setValues(rowData);
  // Order by ellapsed date desc
  range.sort([
    {column: 9, ascending: false},
    {column: 1, ascending: true},
  ]);
  sheet.setRowHeights(2, rows - 1, 21);
}

/**
 * @return Latest message of the last 200 messages
 */
function getLatestChannelMessage(channelId: string) {
  let url = `${SLACK_API_URL}/conversations.history?token=${SLACK_TOKEN}&channel=${channelId}&limit=200`;
  const json = JSON.parse(UrlFetchApp.fetch(url).getContentText());

  for (let message of json.messages) {
    // https://api.slack.com/events/message#subtypes
    if (
      message.type == "message"
      && message.subtype != "channel_leave"
      && message.subtype != "channel_join"
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
  return Utilities.formatDate(new Date(timestamp * 1000), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
}
