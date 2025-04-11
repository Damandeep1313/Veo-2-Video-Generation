require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const getAccessToken = require('./auth');
const axios = require('axios');

const app = express();
app.use(express.json());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.post('/generate-video', async (req, res) => {
  const prompt = req.body.prompt;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  try {
    const accessToken = await getAccessToken();

    // Example: Replace with actual Google Veo API logic
    const fakeVideoBuffer = Buffer.from('FAKE_VIDEO_CONTENT');
    const fileName = `${uuidv4()}.mp4`;
    const filePath = path.join(__dirname, 'videos', fileName);

    fs.writeFileSync(filePath, fakeVideoBuffer);

    const uploadResult = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: 'veo-generated',
    });

    fs.unlinkSync(filePath);

    res.json({ url: uploadResult.secure_url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.toString() });
  }
});

app.get('/', (req, res) => {
  res.send('✅ Veo API Server running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
