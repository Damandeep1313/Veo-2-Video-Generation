require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Google Cloud & model config
const project = process.env.GCLOUD_PROJECT;
const location = process.env.GCLOUD_LOCATION;
const model = process.env.GCLOUD_MODEL;
const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

// Get Google Cloud Access Token
const accessToken = () => new Promise((resolve, reject) => {
  exec('gcloud auth print-access-token', (err, stdout) => {
    if (err) reject(err);
    else resolve(stdout.trim());
  });
});

// Sleep utility
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Send initial request to Veo model
const sendRequest = (token, prompt, aspectRatio, durationSeconds) => new Promise((resolve, reject) => {
  const requestData = JSON.stringify({
    endpoint: `projects/${project}/locations/${location}/publishers/google/models/${model}`,
    instances: [{ prompt }],
    parameters: {
      aspectRatio: aspectRatio || "16:9",
      sampleCount: 1,
      durationSeconds: durationSeconds || "4",
      personGeneration: "allow_adult",
      enablePromptRewriting: true,
      addWatermark: true,
      includeRaiReason: true,
    }
  });

  const req = https.request(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    }
  }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(body);
        if (json.name) resolve(json.name);
        else reject("No operation name received");
      } catch (e) {
        reject("Failed to parse response: " + body);
      }
    });
  });

  req.on('error', reject);
  req.write(requestData);
  req.end();
});

// Poll until video is generated
const pollUntilDone = (operationName, token) => new Promise(async (resolve, reject) => {
  const pollUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;

  for (let attempts = 1; attempts <= 15; attempts++) {
    console.log(`Polling attempt ${attempts}...`);

    const res = await new Promise((resolvePoll, rejectPoll) => {
      const req = https.request(pollUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.done) resolvePoll(json);
            else resolvePoll(null);
          } catch (e) {
            rejectPoll("Polling response error: " + body);
          }
        });
      });

      req.on('error', rejectPoll);
      req.write(JSON.stringify({ operationName }));
      req.end();
    });

    if (res) return resolve(res);
    await sleep(2000 * attempts);
  }

  reject("Timed out waiting for video generation.");
});

// Upload to Cloudinary
async function uploadToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: 'veo2_generated_videos',
    });
    return result.secure_url;
  } catch (err) {
    console.error("❌ Cloudinary upload failed:", err);
    throw err;
  }
}

// Main route
app.post('/generate', async (req, res) => {
  const { prompt, aspectRatio, durationSeconds } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing 'prompt' in request body." });

  const id = uuidv4();

  try {
    const token = await accessToken();
    const operationName = await sendRequest(token, prompt, aspectRatio, durationSeconds);
    const result = await pollUntilDone(operationName, token);

    const videoBase64 = result?.response?.videos?.[0]?.bytesBase64Encoded;
    if (!videoBase64) return res.status(500).json({ error: "No video found in response." });

    const buffer = Buffer.from(videoBase64, 'base64');
    const videoPath = path.join(__dirname, `video_${id}.mp4`);
    fs.writeFileSync(videoPath, buffer);

    const cloudinaryUrl = await uploadToCloudinary(videoPath);
    fs.unlinkSync(videoPath); // cleanup

    return res.json({ videoUrl: cloudinaryUrl });
  } catch (err) {
    console.error("❌ Error in /generate:", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
