import { WebClient } from "@slack/web-api";

const token =
  PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");
const web = new WebClient(token);

const channelId =
  PropertiesService.getScriptProperties().getProperty("TARGET_CHANNEL_ID");

function testPost() {
  (async () => {
    const res = await web.chat.postMessage({
      channel: channelId,
      text: "Hello there",
    });

    Logger.log(res.ts);
  })();
}
