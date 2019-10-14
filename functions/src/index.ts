import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as util from 'util';
import * as os from 'os';
import * as Twitter from 'twitter';
import * as path from 'path';
const textToSpeech = require('@google-cloud/text-to-speech');
const consumer_key = functions.config().twitter.consumer.key;
const consumer_secret = functions.config().twitter.consumer.secret;
const access_token_key = functions.config().twitter.accesstoken.key;
const access_token_secret = functions.config().twitter.accesstoken.secret;
admin.initializeApp();
const bucket = admin.storage().bucket();
const speech_client = new textToSpeech.TextToSpeechClient();
const twitter_client = new Twitter({
  consumer_key: consumer_key,
  consumer_secret: consumer_secret,
  access_token_key: access_token_key,
  access_token_secret: access_token_secret
});
let downloadURL = '';

export const getTweet = functions.https.onCall(async (data, context) => {
  const result = await getTweetsFromTwitter();
  if (result !== undefined) {
    return {
      downloadURL: `error:${result}`
    };
  }
  return {
    downloadURL: downloadURL
  };
});

// HTTP enpoint that reads latest tweets and uploads mp3s to GCS
export const getTweets = functions.https.onRequest(async (request, response) => {
  const result = await getTweetsFromTwitter();
  if (result !== undefined) {
    response.send({'text': `error:${result}`});
  }
  response.send({'text': 'upload complete!'});
});
 
async function getTweetsFromTwitter() {
// Get tweets from twitter
const params = { count: 1 };
try {
  const res = await twitter_client.get('statuses/home_timeline', params);
  for (const tweet in res) {
    console.log(res[tweet].text);
    const user = res[tweet].user.name;
    const currTweet = res[tweet].text;
    const trimTweet = currTweet.split('https://');
    await writeToAudio(`${user} says, ${trimTweet[0]}`);
  }
} catch (error) {
  return error;
}

}

async function writeToAudio(text: string) {
  // create a name for the file
  let name = text.slice(0,4);
  name = name.trim();
  const outputFile = `output_${name}.mp3`;
  const tempFilePath = path.join(os.tmpdir(), outputFile);
  downloadURL = `https://storage.googleapis.com/twitter-speech.appspot.com/${outputFile}`
  downloadURL = encodeURI(downloadURL);
  console.log(downloadURL);

  const request = {
    input: {text: text},
    voice: {languageCode: 'en-US', ssmlGender: 'FEMALE'},
    audioConfig: {audioEncoding: 'MP3'},
  };
  const [resp] = await speech_client.synthesizeSpeech(request);
  const writeFile = util.promisify(fs.writeFile);
  await writeFile(tempFilePath, resp.audioContent);
  await writeToCloudStorage(tempFilePath);
  console.log(`Audio content written to file: ${outputFile}`);
}

async function writeToCloudStorage(outputFile: string) {
  await bucket.upload(outputFile, {
    gzip: true,
    metadata: {
      cacheControl: 'public, max-age=31536000',
    },
  })
  fs.unlinkSync(outputFile);
}

