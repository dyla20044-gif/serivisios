const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadToR2 } = require('./r2Storage');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/create-post', upload.single('media'), async (req, res) => {
  try {
    const { userId, content, isCreator, videoUrl, title } = req.body;
    let mediaUrl = null;

    if (req.file) {
      const fileName = `${Date.now()}_${req.file.originalname}`;
      const uploadResult = await uploadToR2(req.file.buffer, fileName, req.file.mimetype);
      
      if (uploadResult.success) {
        mediaUrl = `${process.env.R2_PUBLIC_URL}/${uploadResult.fileName}`;
      } else {
        return res.status(500).json({ error: 'Error al subir multimedia' });
      }
    }

    const newPost = {
      userId,
      content,
      mediaUrl,
      createdAt: new Date(),
      type: isCreator === 'true' ? 'video_link' : 'standard'
    };

    if (isCreator === 'true') {
      newPost.videoUrl = videoUrl;
      newPost.title = title;
    }

    res.status(201).json({ success: true, post: newPost });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/report', async (req, res) => {
  try {
    const { postId, userId, reason } = req.body;
    
    const report = {
      postId,
      userId,
      reason,
      reportedAt: new Date(),
      status: 'pending'
    };

    res.status(201).json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
