module.exports = function(app, ctx) {
    const { getMongoDb, TMDB_API_KEY, ADMIN_CHAT_IDS, bot } = ctx;
    const { 
        pinnedCache, kdramaCache, catalogCache, tmdbCache, 
        recentCache, requestsCache, localDetailsCache, embedCache, countsCache 
    } = ctx.caches;
    const { 
        PINNED_CACHE_KEY, KDRAMA_CACHE_KEY, CATALOG_CACHE_KEY, 
        RECENT_CACHE_KEY, REQUESTS_CACHE_KEY 
    } = ctx.cacheKeys;
    const { verifyIdToken } = ctx.middlewares;
    const { calculateAndRecordRevenue, sendNotificationToTopic, axios } = ctx.utils;

    function formatLocalItem(item, type) {
        let numericId = parseInt(String(item.tmdbId).replace(/\D/g, ''));
        if (isNaN(numericId)) numericId = Date.now(); 
        return {
            id: numericId, tmdbId: item.tmdbId, title: item.title || item.name, name: item.name || item.title,
            poster_path: item.poster_path, backdrop_path: item.backdrop_path, media_type: type,
            isPinned: item.isPinned || false, isLocal: true, addedAt: item.addedAt 
        };
    }

    app.get('/api/updates-count', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ count: 0 });
        try {
            let reqCount = requestsCache.get(REQUESTS_CACHE_KEY)?.length || 0;
            let recCount = recentCache.get(RECENT_CACHE_KEY)?.length || 0;
            if (reqCount === 0) reqCount = await mongoDb.collection('movie_requests').countDocuments();
            if (recCount === 0) recCount = await mongoDb.collection('media_catalog').countDocuments() + await mongoDb.collection('series_catalog').countDocuments();
            res.status(200).json({ count: reqCount + recCount });
        } catch (e) { res.status(200).json({ count: 0 }); }
    });

    // --- NUEVA RUTA: BÓVEDA EXCLUSIVA ---
    app.get('/api/content/exclusive', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const cacheKey = 'exclusive_catalog_data';
        try {
            const cached = recentCache.get(cacheKey);
            if (cached) return res.status(200).json(cached);
            
            const items = await mongoDb.collection('exclusive_catalog').find({}).sort({ addedAt: -1 }).limit(100).toArray();
            recentCache.set(cacheKey, items);
            res.status(200).json(items);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/content/featured', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
        const cachedPinned = pinnedCache.get(PINNED_CACHE_KEY);
        if (cachedPinned) return res.status(200).json(cachedPinned);

        try {
            const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, isPinned: 1 };
            const movies = await mongoDb.collection('media_catalog').find({ isPinned: true }).project(projection).sort({ addedAt: -1 }).limit(10).toArray();
            const series = await mongoDb.collection('series_catalog').find({ isPinned: true }).project(projection).sort({ addedAt: -1 }).limit(10).toArray();
            
            const combined = [...movies.map(m => formatLocalItem(m, 'movie')), ...series.map(s => formatLocalItem(s, 'tv'))].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
            pinnedCache.set(PINNED_CACHE_KEY, combined);
            res.status(200).json(combined);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/content/kdramas', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
        const cachedKdramas = kdramaCache.get(KDRAMA_CACHE_KEY);
        if (cachedKdramas) return res.status(200).json(cachedKdramas);

        try {
            const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, origin_country: 1 };
            const movies = await mongoDb.collection('media_catalog').find({ origin_country: "KR" }).project(projection).sort({ addedAt: -1 }).limit(50).toArray();
            const series = await mongoDb.collection('series_catalog').find({ origin_country: "KR" }).project(projection).sort({ addedAt: -1 }).limit(50).toArray();
            const combined = [...movies.map(m => formatLocalItem(m, 'movie')), ...series.map(s => formatLocalItem(s, 'tv'))].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
            kdramaCache.set(KDRAMA_CACHE_KEY, combined);
            res.status(200).json(combined);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/content/catalog', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
        const genre = req.query.genre;
        const cacheKey = genre ? `catalog_genre_${genre}` : CATALOG_CACHE_KEY;
        const cachedCatalog = catalogCache.get(cacheKey);
        if (cachedCatalog) return res.status(200).json({ items: cachedCatalog, total: cachedCatalog.length });

        try {
            const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, media_type: 1, addedAt: 1, origin_country: 1, genres: 1 };
            let combined = [];

            if (!genre) {
                const movies = await mongoDb.collection('media_catalog').find({}).project(projection).sort({ addedAt: -1 }).limit(500).toArray();
                const series = await mongoDb.collection('series_catalog').find({}).project(projection).sort({ addedAt: -1 }).limit(500).toArray();
                combined = [...movies.map(m => formatLocalItem(m, 'movie')), ...series.map(s => formatLocalItem(s, 'tv'))].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
            } else {
                const genreId = parseInt(genre);
                const movies = await mongoDb.collection('media_catalog').find({ genres: genreId }).project(projection).sort({ addedAt: -1 }).limit(100).toArray();
                const series = await mongoDb.collection('series_catalog').find({ genres: genreId }).project(projection).sort({ addedAt: -1 }).limit(100).toArray();
                combined = [...movies.map(m => formatLocalItem(m, 'movie')), ...series.map(s => formatLocalItem(s, 'tv'))].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

                if (combined.length < 18) {
                    const needed = 18 - combined.length;
                    try {
                        const tmdbUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&language=es-MX&sort_by=popularity.desc&include_adult=false&page=1`;
                        const resp = await axios.get(tmdbUrl);
                        let addedCount = 0; const existingIds = new Set(combined.map(i => String(i.tmdbId)));
                        for (const item of (resp.data.results || [])) {
                            if (addedCount >= needed) break;
                            const sId = String(item.id);
                            if (!existingIds.has(sId)) {
                                combined.push({ id: item.id, tmdbId: sId, title: item.title, name: item.title, poster_path: item.poster_path, backdrop_path: item.backdrop_path, media_type: 'movie', isPinned: false, isLocal: false, addedAt: new Date(0) });
                                existingIds.add(sId); addedCount++;
                            }
                        }
                    } catch (tmdbError) {}
                }
            }
            catalogCache.set(cacheKey, combined);
            res.status(200).json({ items: combined, total: combined.length });
        } catch (error) { res.status(500).json({ error: "Error interno al obtener catálogo." }); }
    });

    app.get('/api/content/local', verifyIdToken, async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const { type, genre, category } = req.query; 
        
        try {
            const collection = (type === 'tv') ? mongoDb.collection('series_catalog') : mongoDb.collection('media_catalog');
            const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, genres: 1 };

            if (category === 'populares' || category === 'tendencias' || category === 'series_populares') {
                let tmdbEndpoint = category === 'populares' ? 'movie/popular' : (category === 'series_populares' ? 'tv/popular' : 'trending/all/day');
                let tmdbList = tmdbCache.get(`smart_cross_${category}`);
                if (!tmdbList) {
                    try {
                        const resp = await axios.get(`https://api.themoviedb.org/3/${tmdbEndpoint}?api_key=${TMDB_API_KEY}&language=es-MX`);
                        tmdbList = resp.data.results || [];
                        tmdbCache.set(`smart_cross_${category}`, tmdbList, 3600); 
                    } catch (e) { return res.status(200).json([]); }
                }
                const targetIds = tmdbList.map(item => item.id.toString());
                let localMatches = [];
                if (category === 'tendencias') {
                    const movies = await mongoDb.collection('media_catalog').find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                    const series = await mongoDb.collection('series_catalog').find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                    localMatches = [...movies.map(m => formatLocalItem(m, 'movie')), ...series.map(s => formatLocalItem(s, 'tv'))];
                } else {
                    const matches = await collection.find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                    localMatches = matches.map(m => formatLocalItem(m, type === 'tv' ? 'tv' : 'movie'));
                }
                const sortedMatches = [];
                targetIds.forEach(id => { const match = localMatches.find(m => m.tmdbId === id); if (match) sortedMatches.push(match); });
                return res.status(200).json(sortedMatches);
            }

            if (genre) {
                const genreId = parseInt(genre);
                let items = await collection.find({ genres: genreId }).project(projection).sort({ addedAt: -1 }).limit(20).toArray();
                if (items.length < 5) {
                    const candidates = await collection.find({}).project(projection).sort({ addedAt: -1 }).limit(50).toArray();
                    const verified = [];
                    for (const item of candidates) {
                        if (items.find(i => i.tmdbId === item.tmdbId)) continue; 
                        let hasGenre = false;
                        if (item.genres && Array.isArray(item.genres) && item.genres.length > 0) {
                            if (item.genres.includes(genreId)) hasGenre = true;
                        } else {
                            const cacheKey = `genre_chk_${type}_${item.tmdbId}`;
                            let cachedGenres = localDetailsCache.get(cacheKey);
                            if (!cachedGenres) {
                                try {
                                    const resp = await axios.get(`https://api.themoviedb.org/3/${type}/${item.tmdbId}?api_key=${TMDB_API_KEY}`);
                                    cachedGenres = resp.data.genres.map(g => g.id);
                                    localDetailsCache.set(cacheKey, cachedGenres);
                                    await collection.updateOne({ _id: item._id }, { $set: { genres: cachedGenres } });
                                } catch (e) {}
                            }
                            if (cachedGenres && cachedGenres.includes(genreId)) hasGenre = true;
                        }
                        if (hasGenre) verified.push(item);
                        if (verified.length + items.length >= 20) break; 
                    }
                    items = [...items, ...verified];
                }
                return res.status(200).json(items.map(i => formatLocalItem(i, type === 'tv' ? 'tv' : 'movie')));
            }

            const allItems = await collection.find({}).project(projection).sort({ addedAt: -1 }).limit(100).toArray();
            res.status(200).json(allItems.map(i => formatLocalItem(i, type === 'tv' ? 'tv' : 'movie')));
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/tmdb-proxy', async (req, res) => {
        const { endpoint, query, page, with_genres, with_keywords, sort_by } = req.query;
        if (!endpoint) return res.status(400).json({ error: 'Endpoint is required' });
        const cacheKey = JSON.stringify(req.query);
        const cachedResponse = tmdbCache.get(cacheKey);
        if (cachedResponse) return res.json(cachedResponse);

        try {
            const params = { api_key: TMDB_API_KEY, language: 'es-MX', include_adult: false };
            if (query) params.query = query; if (page) params.page = page;
            if (with_genres) params.with_genres = with_genres; if (with_keywords) params.with_keywords = with_keywords;
            if (sort_by) params.sort_by = sort_by;

            const response = await axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params });
            tmdbCache.set(cacheKey, response.data);
            res.json(response.data);
        } catch (error) { res.status(error.response ? error.response.status : 500).json({ error: 'Error al conectar con TMDB' }); }
    });

    app.get('/api/content/recent', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const cachedRecent = recentCache.get(RECENT_CACHE_KEY);
        if (cachedRecent) return res.status(200).json(cachedRecent);

        try {
            // Aumentado a 100 para mejorar la precisión de los numeritos
            const moviesPromise = mongoDb.collection('media_catalog').find({ hideFromRecent: { $ne: true } }).project({ tmdbId: 1, title: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, genres: 1, genre_ids: 1 }).sort({ addedAt: -1 }).limit(100).toArray();
            const seriesPromise = mongoDb.collection('series_catalog').find({}).project({ tmdbId: 1, name: 1, title: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, genres: 1, genre_ids: 1 }).sort({ addedAt: -1 }).limit(100).toArray();
            const [movies, series] = await Promise.all([moviesPromise, seriesPromise]);
            
            const combined = [
                ...movies.map(m => ({ id: m.tmdbId, tmdbId: m.tmdbId, title: m.title, poster_path: m.poster_path, backdrop_path: m.backdrop_path, media_type: 'movie', genre_ids: m.genres || m.genre_ids || [], addedAt: m.addedAt ? new Date(m.addedAt) : new Date(0) })),
                ...series.map(s => ({ id: s.tmdbId, tmdbId: s.tmdbId, title: s.name || s.title || "Serie Actualizada", poster_path: s.poster_path, backdrop_path: s.backdrop_path, media_type: 'tv', genre_ids: s.genres || s.genre_ids || [], addedAt: s.addedAt ? new Date(s.addedAt) : new Date(0) }))
            ].sort((a, b) => b.addedAt - a.addedAt);
            
            recentCache.set(RECENT_CACHE_KEY, combined);
            res.status(200).json(combined);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.post('/request-movie', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const { title, poster_path, tmdbId, priority } = req.body;
        if (!tmdbId || !title) return res.status(400).json({ error: 'Faltan datos.' });

        try {
            const cleanId = String(tmdbId).trim();
            await mongoDb.collection('movie_requests').updateOne({ tmdbId: cleanId }, { $set: { title, poster_path, latestPriority: priority || 'regular', updatedAt: new Date() }, $inc: { votes: 1 } }, { upsert: true });

            if (priority && priority !== 'regular') {
                const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                let pt = priority === 'fast' ? '⚡ Rápido (~24h)' : (priority === 'immediate' ? '🚀 Inmediato (~1h)' : '👑 PREMIUM');
                const message = `🔔 *Solicitud PRIORITARIA:* ${title}\n*Nivel:* ${pt}\n\nSe ha registrado/actualizado.`;
                for (const adminId of ADMIN_CHAT_IDS) {
                    try { await bot.sendPhoto(adminId, posterUrl, { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Gestionar (Subir ahora)', callback_data: `solicitud_${tmdbId}` }]] } }); } catch (err) {}
                }
            }
            requestsCache.del(REQUESTS_CACHE_KEY);
            res.status(200).json({ message: 'Solicitud guardada.' });
        } catch (error) { res.status(500).json({ error: 'Error al procesar solicitud.' }); }
    });

    app.get('/api/requests/fulfilled', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const cachedReqs = requestsCache.get(REQUESTS_CACHE_KEY);
        if (cachedReqs) return res.status(200).json(cachedReqs);
        try {
            // Aumentado a 100 para sincronización perfecta
            const allRequests = await mongoDb.collection('movie_requests').find({}).sort({ votes: -1, fulfilledAt: -1 }).limit(100).toArray();
            requestsCache.set(REQUESTS_CACHE_KEY, allRequests);
            res.status(200).json(allRequests);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/get-movie-data', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        if (!req.query.id) return res.status(400).json({ error: "ID requerido." });
        const cacheKey = `counts-data-${req.query.id}`;
        try { const cachedData = countsCache.get(cacheKey); if (cachedData) return res.status(200).json(cachedData); } catch (err) {}

        try {
            let docSeries = await mongoDb.collection('series_catalog').findOne({ tmdbId: req.query.id.toString() }, { projection: { views: 1, likes: 1, seasons: 1 } });
            if (docSeries) {
                let isAvail = docSeries.seasons && Object.values(docSeries.seasons).some(season => season?.episodes && Object.values(season.episodes).some(ep => (ep.freeEmbedCode) || (ep.proEmbedCode)));
                if (isAvail) { const r = { views: docSeries.views || 0, likes: docSeries.likes || 0, isAvailable: true }; countsCache.set(cacheKey, r); return res.status(200).json(r); }
            }
            let docMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: req.query.id.toString() }, { projection: { views: 1, likes: 1, freeEmbedCode: 1, proEmbedCode: 1 } });
            if (docMovie) {
                const r = { views: docMovie.views || 0, likes: docMovie.likes || 0, isAvailable: !!(docMovie.freeEmbedCode || docMovie.proEmbedCode) };
                countsCache.set(cacheKey, r); return res.status(200).json(r);
            }
            const rNotFound = { views: 0, likes: 0, isAvailable: false };
            countsCache.set(cacheKey, rNotFound); res.status(200).json(rNotFound);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/get-embed-code', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const { id, season, episode, isPro } = req.query;
        if (!id) return res.status(400).json({ error: "ID no proporcionado" });
        const cacheKey = `embed-${id}-${season || 'movie'}-${episode || '1'}-${isPro === 'true' ? 'pro' : 'free'}`;
        try { const c = embedCache.get(cacheKey); if (c) return res.json({ embedCode: c }); } catch (err) {}

        try {
            const isSeries = season && episode;
            const doc = await mongoDb.collection(isSeries ? 'series_catalog' : 'media_catalog').findOne({ tmdbId: id.toString() });
            if (!doc) return res.status(404).json({ error: "No encontrada." });
            let code = null;
            if (!isSeries) code = (isPro === 'true') ? doc.proEmbedCode : doc.freeEmbedCode;
            else { const ep = doc.seasons?.[season]?.episodes?.[episode]; if (ep) code = (isPro === 'true') ? ep.proEmbedCode : ep.freeEmbedCode; }
            if (code) { embedCache.set(cacheKey, code); return res.json({ embedCode: code }); }
            return res.status(404).json({ error: `No se encontró código.` });
        } catch (error) { res.status(500).json({ error: "Error interno" }); }
    });

    app.get('/api/check-season-availability', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const { id, season } = req.query;
        if (!id || !season) return res.status(400).json({ error: "Faltan datos." });
        try {
            const doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [`seasons.${season}.episodes`]: 1 } });
            if (!doc?.seasons?.[season]?.episodes) return res.status(200).json({ exists: false, availableEpisodes: {} });
            const eps = doc.seasons[season].episodes; const map = {};
            for (const n in eps) map[n] = !!(eps[n].proEmbedCode || eps[n].freeEmbedCode);
            res.status(200).json({ exists: true, availableEpisodes: map });
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.get('/api/get-metrics', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        const { id, field } = req.query;
        if (!id || !field) return res.status(400).json({ error: "Faltan datos." });
        const cacheKey = `counts-metrics-${id}-${field}`;
        try { const c = countsCache.get(cacheKey); if (c) return res.status(200).json(c); } catch (err) {}
        try {
            let doc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
            if (!doc) doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
            const r = { count: doc?.[field] || 0 }; countsCache.set(cacheKey, r); res.status(200).json(r);
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.post('/api/increment-views', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        if (!req.body.tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
        try {
            const upd = { $inc: { views: 1 }, $setOnInsert: { likes: 0 } };
            let r = await mongoDb.collection('media_catalog').updateOne({ tmdbId: req.body.tmdbId.toString() }, upd, { upsert: true });
            if (r.matchedCount === 0 && r.upsertedCount === 0) await mongoDb.collection('series_catalog').updateOne({ tmdbId: req.body.tmdbId.toString() }, upd, { upsert: true });
            countsCache.del(`counts-data-${req.body.tmdbId}`); countsCache.del(`counts-metrics-${req.body.tmdbId}-views`);
            res.status(200).json({ message: 'Vista registrada.' });
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.post('/api/increment-likes', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        if (!req.body.tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
        try {
            const upd = { $inc: { likes: 1 }, $setOnInsert: { views: 0 } };
            let r = await mongoDb.collection('media_catalog').updateOne({ tmdbId: req.body.tmdbId.toString() }, upd, { upsert: true });
            if (r.matchedCount === 0 && r.upsertedCount === 0) await mongoDb.collection('series_catalog').updateOne({ tmdbId: req.body.tmdbId.toString() }, upd, { upsert: true });
            countsCache.del(`counts-data-${req.body.tmdbId}`); countsCache.del(`counts-metrics-${req.body.tmdbId}-likes`);
            res.status(200).json({ message: 'Like registrado.' });
        } catch (error) { res.status(500).json({ error: "Error interno." }); }
    });

    app.post('/add-movie', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        try {
            const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview, hideFromRecent, genres, release_date, popularity, vote_average, isPinned, origin_country, links, uploaderId } = req.body;
            if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
            
            const cleanId = String(tmdbId).trim();
            const docAnt = await mongoDb.collection('media_catalog').findOne({ tmdbId: cleanId });
            const eraFantasma = !docAnt || !(docAnt.freeEmbedCode || docAnt.proEmbedCode);

            const result = await mongoDb.collection('media_catalog').updateOne(
                { tmdbId: cleanId },
                { $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium, hideFromRecent: hideFromRecent === true || hideFromRecent === 'true', genres: genres || [], release_date: release_date || null, popularity: popularity || 0, vote_average: vote_average || 0, isPinned: isPinned === true || isPinned === 'true', origin_country: origin_country || [], links: links || [], uploaderId: uploaderId || null, addedAt: new Date() }, $setOnInsert: { tmdbId: cleanId, views: 0, likes: 0 } },
                { upsert: true }
            );

            let rev = null;
            if (eraFantasma && uploaderId) rev = await calculateAndRecordRevenue({ uploaderId, tmdbId: cleanId, mediaType: 'movie', title });
            try { await mongoDb.collection('movie_requests').updateOne({ tmdbId: cleanId }, { $set: { status: 'subido', fulfilledAt: new Date() } }); } catch (e) {}
            
            embedCache.del(`embed-${cleanId}-movie-1-pro`); embedCache.del(`embed-${cleanId}-movie-1-free`); countsCache.del(`counts-data-${cleanId}`); recentCache.del(RECENT_CACHE_KEY); pinnedCache.del(PINNED_CACHE_KEY); kdramaCache.del(KDRAMA_CACHE_KEY); requestsCache.del(REQUESTS_CACHE_KEY); catalogCache.flushAll(); recentCache.del('exclusive_catalog_data');
            res.status(200).json({ message: 'Película publicada.', upserted: result.upsertedCount > 0, revenue: rev });
        } catch (error) { res.status(500).json({ error: 'Error interno.' }); }
    });

    app.post('/add-series-episode', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        try {
            const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium, genres, first_air_date, popularity, vote_average, isPinned, origin_country, uploaderId } = req.body;
            if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'Faltan datos.' });
            
            const cleanId = String(tmdbId).trim(); const sNum = parseInt(seasonNumber); const eNum = parseInt(episodeNumber);
            const seriesDoc = await mongoDb.collection('series_catalog').findOne({ tmdbId: cleanId });
            const teniaLinks = seriesDoc?.seasons?.[sNum]?.episodes?.[eNum] && (seriesDoc.seasons[sNum].episodes[eNum].freeEmbedCode || seriesDoc.seasons[sNum].episodes[eNum].proEmbedCode);
            const epPath = `seasons.${sNum}.episodes.${eNum}`;

            await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanId }, { $set: { title, poster_path, overview, isPremium, genres: genres || [], first_air_date: first_air_date || null, popularity: popularity || 0, vote_average: vote_average || 0, isPinned: isPinned === true || isPinned === 'true', origin_country: origin_country || [], uploaderId: uploaderId || null, [`seasons.${sNum}.name`]: `Temporada ${sNum}`, [epPath + '.freeEmbedCode']: freeEmbedCode, [epPath + '.proEmbedCode']: proEmbedCode, [epPath + '.uploaderId']: uploaderId || null, [epPath + '.addedAt']: new Date(), addedAt: new Date() }, $setOnInsert: { tmdbId: cleanId, views: 0, likes: 0 } }, { upsert: true });
            
            let rev = null;
            if (!teniaLinks && uploaderId) rev = await calculateAndRecordRevenue({ uploaderId, tmdbId: cleanId, mediaType: 'tv', title: `${title} S${sNum}E${eNum}`, season: sNum, episode: eNum });
            try { await mongoDb.collection('movie_requests').updateOne({ tmdbId: cleanId }, { $set: { status: 'subido', fulfilledAt: new Date() } }); } catch (e) {}

            embedCache.del(`embed-${cleanId}-${sNum}-${eNum}-pro`); embedCache.del(`embed-${cleanId}-${sNum}-${eNum}-free`); countsCache.del(`counts-data-${cleanId}`); recentCache.del(RECENT_CACHE_KEY); pinnedCache.del(PINNED_CACHE_KEY); kdramaCache.del(KDRAMA_CACHE_KEY); requestsCache.del(REQUESTS_CACHE_KEY); catalogCache.flushAll(); recentCache.del('exclusive_catalog_data');
            res.status(200).json({ message: `Episodio S${sNum}E${eNum} publicado.`, revenue: rev });
        } catch (error) { res.status(500).json({ error: 'Error interno.' }); }
    });

    app.post('/delete-series-episode', async (req, res) => {
        const mongoDb = getMongoDb();
        if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
        try {
            const { tmdbId, seasonNumber, episodeNumber } = req.body;
            if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'Faltan datos.' });
            const sNum = parseInt(seasonNumber); const eNum = parseInt(episodeNumber);
            await mongoDb.collection('series_catalog').updateOne({ tmdbId: String(tmdbId).trim() }, { $unset: { [`seasons.${sNum}.episodes.${eNum}`]: "" } });
            embedCache.del(`embed-${tmdbId}-${sNum}-${eNum}-pro`); embedCache.del(`embed-${tmdbId}-${sNum}-${eNum}-free`); catalogCache.flushAll();
            res.status(200).json({ message: 'Episodio eliminado.' });
        } catch (error) { res.status(500).json({ error: 'Error interno.' }); }
    });

    app.post('/api/notify-new-content', async (req, res) => {
        const { title, body, imageUrl, tmdbId, mediaType } = req.body;
        if (!title || !body || !tmdbId || !mediaType) return res.status(400).json({ success: false, error: "Faltan datos requeridos." });
        try {
            const result = await sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType);
            if (result.success) res.status(200).json({ success: true, message: result.message, details: result.response });
            else res.status(500).json({ success: false, error: 'Error FCM.', details: result.error });
        } catch (error) { res.status(500).json({ success: false, error: "Error interno." }); }
    });
};
