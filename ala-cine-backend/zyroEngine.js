const axios = require('axios');
const cheerio = require('cheerio');
const { URLSearchParams } = require('url');

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // --- 1. ENDPOINT: DEEP SCRAPING (Intacto y seguro) ---
    app.get('/api/analyze-media', async (req, res) => {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: "Falta el parámetro 'url'" });

        const cacheKey = `zyro_deep_scrape_${Buffer.from(url).toString('base64')}`;
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) return res.json(cachedResult);

        try {
            const scrapeRes = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 15000
            });
            const $ = cheerio.load(scrapeRes.data);
            let temporadasCount = 1;
            let capitulos = [];
            let fuentes_extra = [];

            $('a, li, div.episode').each((i, el) => {
                const texto = $(el).text().trim();
                let href = $(el).attr('href') || $(el).find('a').attr('href');
                if (/cap[íi]tulo|episodio|\d+x\d+|e\d+/i.test(texto) && href) {
                    try { capitulos.push({ nombre: texto.substring(0, 50), url_del_capitulo: new URL(href, url).href }); } catch (e) {}
                }
            });

            const videoMatches = scrapeRes.data.match(/(https?:\/\/[^\s"'<>]+?\.(m3u8|mp4))/gi) || [];
            videoMatches.forEach(v => fuentes_extra.push(v));

            const respuestaAnalisis = { temporadas: temporadasCount, capitulos, fuentes_extra: [...new Set(fuentes_extra)] };
            cache.set(cacheKey, respuestaAnalisis, capitulos.length > 0 ? 1800 : 30);
            res.json(respuestaAnalisis);
        } catch (error) {
            res.status(500).json({ error: "No se pudo analizar la URL." });
        }
    });

    // --- 2. ENDPOINT: HOME DINÁMICO (Intacto y seguro) ---
    app.get('/api/zyro-home', async (req, res) => {
        const cacheKey = 'zyro_home_data';
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) return res.json(cachedResult);

        try {
            const estrenosRes = await axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=es-ES&page=1`);
            const tendenciasRes = await axios.get(`https://api.themoviedb.org/3/trending/all/day?api_key=${TMDB_API_KEY}&language=es-ES`);
            
            const respuestaFinal = {
                estrenos: estrenosRes.data.results.slice(0, 10).map(m => ({ id: m.id, titulo: m.title, posterPath: `https://image.tmdb.org/t/p/w500${m.poster_path}`, tipo: 'movie' })),
                tendencias: tendenciasRes.data.results.slice(0, 10).map(t => ({ id: t.id, titulo: t.title || t.name, posterPath: `https://image.tmdb.org/t/p/w500${t.poster_path}`, tipo: t.media_type })),
                carruselTematico: { titulo: "Destacados", items: [] },
                categorias: [
                    { titulo: "Acción", query: "Acción", color: "0xFFE91E63" },
                    { titulo: "Terror", query: "Terror", color: "0xFFFF5722" }
                ]
            };
            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);
        } catch (error) {
            res.status(500).json({ error: "No se pudo cargar el inicio dinámico." });
        }
    });

    // --- 3. ENDPOINT: BUSCADOR UNIVERSAL CON AUTO-INDEXACIÓN (Tu idea implementada) ---
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        const page = parseInt(req.query.page) || 1; 
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        const queryLower = query.toLowerCase().trim();
        const cacheKey = `zyro_univ_v3_${queryLower}_p${page}`;
        
        // PASO 1: Revisar Memoria Caché RAM (Ultra rápido)
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde Memoria Caché: ${query}`);
            return res.json(cachedResult);
        }

        const db = getDb();
        let metadata = null;
        let moduloEspecial = null;
        let enlacesFinales = [];

        try {
            // PASO 2: Revisar si ya alguien buscó esto antes y está en MongoDB (Tu idea)
            if (db) {
                const busquedaGuardada = await db.collection('zyro_search_cache').findOne({ query: queryLower, page: page });
                if (busquedaGuardada) {
                    console.log(`[ZYRO] Sirviendo desde MONGODB (Auto-Indexado): ${query}`);
                    
                    // Asegurar que tus enlaces propios 'zyro_custom_links' siempre tengan prioridad, incluso en caché
                    const customLinks = await db.collection('zyro_custom_links').find({ titulo_pelicula: { $regex: query, $options: 'i' } }).toArray();
                    let enlacesDB = busquedaGuardada.enlaces || [];
                    
                    customLinks.reverse().forEach(link => {
                        // Evitar duplicados si ya estaba
                        if (!enlacesDB.some(e => e.urlDestino === link.urlDestino)) {
                            enlacesDB.unshift({ ...link, isPremium: true });
                        }
                    });

                    const respuestaDB = {
                        metadata: busquedaGuardada.metadata,
                        modulo_destacado: busquedaGuardada.modulo_destacado,
                        enlaces: enlacesDB,
                        paginaActual: page
                    };
                    
                    // Guardamos en memoria RAM por 24 HORAS (86400 segundos) como pediste
                    cache.set(cacheKey, respuestaDB, 86400); 
                    return res.json(respuestaDB);
                }
            }

            // PASO 3: Si nadie lo ha buscado, hacemos el trabajo duro (Web Scraping + APIs)
            console.log(`[ZYRO] Búsqueda nueva. Obteniendo datos en vivo para: ${query}`);

            // A. Conocimiento General (API de Wikipedia - Gratis)
            if (page === 1) {
                try {
                    const wikiRes = await axios.get(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
                    if (wikiRes.data && wikiRes.data.title && wikiRes.data.type !== 'disambiguation') {
                        moduloEspecial = {
                            tipo: 'wiki',
                            titulo: wikiRes.data.title,
                            descripcion: wikiRes.data.extract,
                            imagen: wikiRes.data.thumbnail ? wikiRes.data.thumbnail.source : null,
                            url: wikiRes.data.content_urls.desktop.page
                        };
                    }
                } catch (e) { /* Silencioso si no hay en Wikipedia */ }
            }

            // B. Metadatos TMDB (Películas/Series)
            if (page === 1) {
                try {
                    const tmdb = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
                    if (tmdb.data.results.length > 0) {
                        const best = tmdb.data.results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || tmdb.data.results[0];
                        metadata = { 
                            titulo: best.title || best.name, 
                            poster: best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : null, 
                            descripcion: best.overview || "Búsqueda general",
                            tipo: best.media_type
                        };
                    }
                } catch (e) {}
            }

            // C. Buscador Web Seguro (Bing Scraping en vez de SearXNG)
            try {
                // Modificamos el query internamente para obtener mejores resultados
                const queryModificado = `${query} ver online pelicula gratis`;
                const startIndex = (page - 1) * 10 + 1;
                const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(queryModificado)}&first=${startIndex}`;
                
                const bingRes = await axios.get(bingUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
                    timeout: 6000
                });

                const $ = cheerio.load(bingRes.data);
                $('.b_algo').each((i, el) => {
                    const t = $(el).find('h2 a').text();
                    const u = $(el).find('h2 a').attr('href');
                    const d = $(el).find('.b_caption p').text();
                    
                    if (u && u.startsWith('http')) {
                        enlacesFinales.push({
                            sitioWeb: new URL(u).hostname.replace('www.', ''),
                            titulo: t,
                            descripcion: d || "Resultado web verificado.",
                            urlDestino: u,
                            categoria: 'Fuentes Alternativas',
                            isPremium: false
                        });
                    }
                });
            } catch (e) { console.log("[ZYRO] Error raspando Bing."); }

            // D. Tus Enlaces Personalizados (Prioridad)
            if (db && page === 1) {
                try {
                    const customLinks = await db.collection('zyro_custom_links').find({ titulo_pelicula: { $regex: query, $options: 'i' } }).toArray();
                    customLinks.reverse().forEach(link => {
                        enlacesFinales.unshift({ ...link, isPremium: true });
                    });
                } catch (e) {}
            }

            const respuestaFinal = {
                metadata: metadata,
                modulo_destacado: moduloEspecial,
                enlaces: enlacesFinales,
                paginaActual: page
            };

            // PASO 4: GUARDAR EN LA BASE DE DATOS PARA EL FUTURO (Tu idea en acción)
            if (db && enlacesFinales.length > 0) {
                try {
                    await db.collection('zyro_search_cache').updateOne(
                        { query: queryLower, page: page },
                        { $set: { 
                            query: queryLower, 
                            page: page, 
                            metadata: metadata, 
                            modulo_destacado: moduloEspecial, 
                            enlaces: enlacesFinales.filter(e => !e.isPremium), // Guardamos los resultados limpios sin tus custom links (los agregamos dinámicamente arriba)
                            updatedAt: new Date() 
                        }},
                        { upsert: true } // Esto lo crea si no existe, o lo actualiza si ya estaba
                    );
                    console.log(`[ZYRO] Resultados de '${query}' guardados en MongoDB.`);
                } catch (dbErr) {
                    console.log(`[ZYRO] Error guardando caché en MongoDB:`, dbErr.message);
                }
            }

            // PASO 5: Guardar en caché RAM (24 Horas = 86400 segs) si hubo éxito, sino 60 segs
            if (enlacesFinales.length > 0) {
                cache.set(cacheKey, respuestaFinal, 86400); 
            } else {
                cache.set(cacheKey, respuestaFinal, 60);
            }
            
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico en motor universal:", error);
            res.status(500).json({ metadata: null, modulo_destacado: null, enlaces: [], paginaActual: page });
        }
    });
};
