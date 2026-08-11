const multer = require('multer');
const { uploadToR2 } = require('./r2Storage');

let memCache = {
  feed: { data: null, time: 0 },
  popular: { data: null, time: 0 }
};
const CACHE_TTL = 60000;

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
        type: isCreator === 'true' ? 'video_link' : 'standard',
        likes: 0,
        views: 0,
        shares: 0
      };

      if (isCreator === 'true') {
        newPost.videoUrl = videoUrl;
        newPost.title = title;
      }

      await db.collection('tvision_community_posts').insertOne(newPost);
      memCache.feed.time = 0; 
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
      
      memCache.feed.time = 0;
      memCache.popular.time = 0;
      res.status(200).json({ success: true, profile: userProfile });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/tvision/save-profile-multipart', upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const { userId, name, handle } = req.body;
      let avatarUrl = null;
      let bannerUrl = null;

      if (req.files && req.files['avatar']) {
        const file = req.files['avatar'][0];
        const fileName = `avatar_${Date.now()}_${file.originalname}`;
        const uploadResult = await uploadToR2(file.buffer, fileName, file.mimetype);
        if (uploadResult.success) avatarUrl = `${process.env.R2_PUBLIC_URL}/${uploadResult.fileName}`;
      }

      if (req.files && req.files['banner']) {
        const file = req.files['banner'][0];
        const fileName = `banner_${Date.now()}_${file.originalname}`;
        const uploadResult = await uploadToR2(file.buffer, fileName, file.mimetype);
        if (uploadResult.success) bannerUrl = `${process.env.R2_PUBLIC_URL}/${uploadResult.fileName}`;
      }

      const updateData = {
        name,
        handle,
        updatedAt: new Date()
      };

      if (avatarUrl) updateData.avatarUrl = avatarUrl;
      if (bannerUrl) updateData.bannerUrl = bannerUrl;

      await db.collection('tvision_community_users').updateOne(
        { userId: userId },
        { $set: updateData },
        { upsert: true }
      );

      memCache.feed.time = 0;
      memCache.popular.time = 0;
      res.status(200).json({ success: true, profile: updateData });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/tvision/user-profile/:userId', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const user = await db.collection('tvision_community_users').findOne({ userId: req.params.userId });
      res.status(200).json({ success: true, profile: user || {} });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/tvision/feed', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const now = Date.now();
      if (memCache.feed.data && (now - memCache.feed.time < CACHE_TTL)) {
        return res.status(200).json({ success: true, posts: memCache.feed.data, cached: true });
      }

      const posts = await db.collection('tvision_community_posts').aggregate([
        { $sort: { createdAt: -1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: 'tvision_community_users',
            localField: 'userId',
            foreignField: 'userId',
            as: 'userInfo'
          }
        },
        { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            userId: 1,
            content: 1,
            mediaUrl: 1,
            createdAt: 1,
            type: 1,
            likes: { $ifNull: ["$likes", 0] },
            views: { $ifNull: ["$views", 0] },
            shares: { $ifNull: ["$shares", 0] },
            authorName: { $ifNull: ["$userInfo.name", "Usuario"] },
            authorHandle: { $ifNull: ["$userInfo.handle", "usuario"] },
            authorAvatar: { $ifNull: ["$userInfo.avatarUrl", ""] }
          }
        }
      ]).toArray();

      memCache.feed.data = posts;
      memCache.feed.time = now;

      res.status(200).json({ success: true, posts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/tvision/popular-channels', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const now = Date.now();
      if (memCache.popular.data && (now - memCache.popular.time < CACHE_TTL)) {
        return res.status(200).json({ success: true, channels: memCache.popular.data, cached: true });
      }

      const channels = await db.collection('tvision_community_users').find().limit(15).toArray();
      
      memCache.popular.data = channels;
      memCache.popular.time = now;

      res.status(200).json({ success: true, channels });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/tvision/user-posts/:userId', async (req, res) => {
    try {
      const db = ctx.getMongoDb();
      if (!db) return res.status(503).json({ error: "DB no conectada" });

      const userId = req.params.userId;
      const posts = await db.collection('tvision_community_posts').aggregate([
        { $match: { userId: userId } },
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: 'tvision_community_users',
            localField: 'userId',
            foreignField: 'userId',
            as: 'userInfo'
          }
        },
        { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            userId: 1,
            content: 1,
            mediaUrl: 1,
            createdAt: 1,
            type: 1,
            likes: { $ifNull: ["$likes", 0] },
            views: { $ifNull: ["$views", 0] },
            shares: { $ifNull: ["$shares", 0] },
            authorName: { $ifNull: ["$userInfo.name", "Usuario"] },
            authorHandle: { $ifNull: ["$userInfo.handle", "usuario"] },
            authorAvatar: { $ifNull: ["$userInfo.avatarUrl", ""] }
          }
        }
      ]).toArray();

      res.status(200).json({ success: true, posts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
