const multer = require('multer');
const { uploadToR2 } = require('./r2Storage');

module.exports = function(app, ctx) {
  const upload = multer({ storage: multer.memoryStorage() });

  app.post('/api/tvision/create-post', upload.single('media'), async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

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

      await db.collection('tvision_community_posts').insertOne(newPost);
      res.status(201).json({ success: true, post: newPost });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/tvision/report', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const { postId, userId, reason } = req.body;
      
      const report = {
        postId,
        userId,
        reason,
        reportedAt: new Date(),
        status: 'pending'
      };

      await db.collection('tvision_community_reports').insertOne(report);
      res.status(201).json({ success: true, report });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/tvision/save-profile', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const { userId, name, handle } = req.body;
      
      const userProfile = {
        userId,
        name,
        handle,
        updatedAt: new Date()
      };

      await db.collection('tvision_community_users').updateOne(
        { userId: userId },
        { $set: userProfile },
        { upsert: true }
      );
      
      res.status(200).json({ success: true, profile: userProfile });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/tvision/feed', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const posts = await db.collection('tvision_community_posts').find().sort({ createdAt: -1 }).limit(50).toArray();
      res.status(200).json({ success: true, posts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/tvision/popular-channels', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const channels = await db.collection('tvision_community_users').find().limit(15).toArray();
      res.status(200).json({ success: true, channels });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
