const axios = require('axios');
const cheerio = require('cheerio');
const { URLSearchParams } = require('url');

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // --- ENDPOINT INTACTO: DEEP SCRAPING ---
    app.get('/api/analyze-media', async (req, res) => {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: "Falta el parámetro 'url'" });
        }

        const cacheKey = `zyro_deep_scrape_${Buffer.from(url).toString('base64')}`;
        const cachedResult = cache.get(cacheKey);

        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo análisis profundo desde caché para: ${url}`);
            return res.json(cachedResult);
        }

        try {
            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            ];
            const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

            const scrapeRes = await axios.get(url, {
                headers: {
                    'User-Agent': randomUserAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                },
                timeout: 15000
            });

            const html = scrapeRes.data;
            const $ = cheerio.load(html);

            let temporadasCount = 0;
            let capitulos = [];
            let fuentes_extra = [];

            // 1. Contar Temporadas
            const textoBody = $('body').text().toLowerCase();
            const seasonMatches = textoBody.match(/temporada\s*\d+|season\s*\d+/g);
            
            if (seasonMatches) {
                const temporadasUnicas = new Set(seasonMatches.map(s => s.trim()));
                temporadasCount = temporadasUnicas.size;
            } else {
                temporadasCount = $('select option:contains("Temporada"), ul.seasons li, div.season-tab').length;
            }

            // 2. Extraer Capítulos
            $('a, li, div.episode, div.capitulo').each((index, element) => {
                const el = $(element);
                const texto = el.text().trim();
                const lowerTexto = texto.toLowerCase();
                let href = el.attr('href') || el.find('a').attr('href');

                const pareceCapitulo = /cap[íi]tulo\s*\d+|episodio\s*\d+|\d+x\d+|e\d+/i.test(lowerTexto);

                if (pareceCapitulo && href) {
                    try {
                        const absoluteUrl = new URL(href, url).href;
                        if (!capitulos.some(c => c.url_del_capitulo === absoluteUrl)) {
                            capitulos.push({ nombre: texto.substring(0, 50), url_del_capitulo: absoluteUrl });
                        }
                    } catch (e) {}
                }
            });

            // 3. Extraer Fuentes de Video
            const videoRegex = /(https?:\/\/[^\s"'<>]+?\.(m3u8|mp4))/gi;
            const videoMatches = html.match(videoRegex) || [];
            videoMatches.forEach(v => fuentes_extra.push(v));

            $('iframe').each((i, el) => {
                const src = $(el).attr('src');
                if (src) {
                    const lowerSrc = src.toLowerCase();
                    if (lowerSrc.includes('fembed') || lowerSrc.includes('vidoza') || 
                        lowerSrc.includes('ok.ru') || lowerSrc.includes('streamtape') ||
                        lowerSrc.includes('voe.sx') || lowerSrc.includes('dood')) {
                        fuentes_extra.push(src);
                    }
                }
            });

            fuentes_extra = [...new Set(fuentes_extra)];

            const respuestaAnalisis = {
                temporadas: temporadasCount > 0 ? temporadasCount : 1,
                capitulos: capitulos,
                fuentes_extra: fuentes_extra
            };

            if (capitulos.length > 0 || fuentes_extra.length > 0) {
                cache.set(cacheKey, respuestaAnalisis, 1800);
            } else {
                cache.set(cacheKey, respuestaAnalisis, 30);
            }
            
            res.json(respuestaAnalisis);

        } catch (error) {
            console.error(`[ZYRO] Error en Deep Scraping para ${url}:`, error.message);
            res.status(500).json({ error: "No se pudo analizar la URL proporcionada.", detalles: error.message });
        }
    });

    // --- ENDPOINT INTACTO: HOME DINÁMICO ---
    app.get('/api/zyro-home', async (req, res) => {
        const cacheKey = 'zyro_home_data';
        const cachedResult = cache.get(cacheKey);

        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo Home desde caché`);
            return res.json(cachedResult);
        }

        try {
            const estrenosRes = await axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=es-ES&page=1`);
            const estrenos = estrenosRes.data.results.slice(0, 10).map(m => ({
                id: m.id,
                titulo: m.title,
                subtitulo: `Estreno · ${m.release_date ? m.release_date.substring(0, 4) : ''}`,
                posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                tipo: 'movie'
            }));

            const tendenciasRes = await axios.get(`https://api.themoviedb.org/3/trending/all/day?api_key=${TMDB_API_KEY}&language=es-ES`);
            const tendencias = tendenciasRes.data.results.slice(0, 10).map(t => ({
                id: t.id,
                titulo: t.title || t.name,
                subtitulo: `Tendencia · ${t.media_type === 'movie' ? 'Película' : 'Serie'}`,
                posterPath: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                tipo: t.media_type
            }));

            const currentMonth = new Date().getMonth(); 
            let themeName = 'Destacados del Mes';
            let genreId = 28; 

            if (currentMonth === 9) { 
                themeName = 'Especial de Halloween'; genreId = 27; 
            } else if (currentMonth === 11) { 
                themeName = 'Especial Navideño'; genreId = 10751; 
            }

            const tematicoRes = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=es-ES&with_genres=${genreId}&sort_by=popularity.desc&page=1`);
            const carruselTematico = {
                titulo: themeName,
                items: tematicoRes.data.results.slice(0, 10).map(m => ({
                    id: m.id,
                    titulo: m.title,
                    posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                    anio: m.release_date ? m.release_date.substring(0, 4) : ''
                }))
            };

            const categorias = [
                { titulo: "Acción", query: "Películas de Acción", color: "0xFFE91E63" },
                { titulo: "Terror", query: "Películas de Terror", color: "0xFFFF5722" },
                { titulo: "Ciencia Ficción", query: "Películas de Ciencia Ficción", color: "0xFF9C27B0" },
                { titulo: "Comedia", query: "Películas de Comedia", color: "0xFF00BCD4" }
            ];

            const respuestaFinal = { estrenos, tendencias, carruselTematico, categorias };
            cache.set(cacheKey, respuestaFinal, 3600); 
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error obteniendo Home:", error.message);
            res.status(500).json({ error: "No se pudo cargar el inicio dinámico." });
        }
    });

    // --- NUEVO ENDPOINT REESTRUCTURADO: BÚSQUEDA HÍBRIDA ---
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        const page = parseInt(req.query.page) || 1; 
        
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // 1. Caché RAM (24 Horas)
        const cacheKey = `zyro_hybrid_search_${query.toLowerCase().trim()}_p${page}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde RAM Cache: ${query}`);
            return res.json(cachedResult);
        }

        try {
            const db = getDb();
            let metadata = null;
            let enlacesFinales = [];
            let sugerencias = [];
            
            // 2. CONSULTAS EN VIVO (TMDB y Wikipedia para Metadatos)
            if (page === 1) {
                try {
                    // TMDB Request
                    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=1`);
                    const results = tmdbRes.data.results;
                    
                    if (results && results.length > 0) {
                        const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                        if (bestMatch) {
                            metadata = {
                                tmdb_id: bestMatch.id,
                                titulo: bestMatch.title || bestMatch.name,
                                poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                                tipo: bestMatch.media_type || 'movie',
                                descripcion: bestMatch.overview || "Sin sinopsis disponible en TMDB.",
                                anio: (bestMatch.release_date || bestMatch.first_air_date || '').split('-')[0]
                            };
                        }
                    }

                    // Si TMDB no trae buena descripción, complementamos con Wikipedia en Vivo
                    if (!metadata || metadata.descripcion === "Sin sinopsis disponible en TMDB.") {
                        const wikiRes = await axios.get(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`);
                        if (wikiRes.data.query.search.length > 0) {
                            const wikiData = wikiRes.data.query.search[0];
                            if (!metadata) {
                                metadata = {
                                    tmdb_id: null, titulo: wikiData.title, poster: null, tipo: 'web', 
                                    descripcion: wikiData.snippet.replace(/(<([^>]+)>)/gi, ""), // Limpiar HTML
                                    anio: null
                                };
                            } else {
                                metadata.descripcion = wikiData.snippet.replace(/(<([^>]+)>)/gi, "");
                            }
                        }
                    }
                } catch (liveApiError) {
                    console.log("[ZYRO] Error en APIs en vivo (TMDB/Wiki):", liveApiError.message);
                }
            }

            // Fallback Metadatos
            if (!metadata && page === 1) {
                metadata = { tmdb_id: null, titulo: query, poster: null, tipo: 'web_search', descripcion: `Resultados para: "${query}"`, anio: null };
            }

            // 3. PRIORIDAD DE CONTENIDO: Enlaces Manuales (Siempre en vivo)
            if (db && page === 1) {
                try {
                    const customLinks = await db.collection('zyro_custom_links')
                        .find({ $or: [{ titulo_pelicula: { $regex: new RegExp(query, "i") } }] })
                        .toArray();
                        
                    customLinks.reverse().forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion || "Enlace destacado y verificado.",
                            calidad: link.calidad || "Premium",
                            urlDestino: link.urlDestino,
                            categoria: "Destacado",
                            isPremium: true
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO] Error obteniendo Custom Links:", dbErr.message);
                }
            }

            // 4. SMART CACHE: Tolerancia a Errores en MongoDB
            let scrapedLinks = [];
            let requiereScraping = true;

            if (db) {
                const searchCacheCol = db.collection('zyro_search_cache');
                
                // Expresión Regular para Fuzzy Search (Ej: "fase" tolera variaciones)
                const safeQuery = query.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const fuzzyPattern = safeQuery.split('').join('.?'); // Permite ligeros typos
                
                const cachedDbScrape = await searchCacheCol.findOne({
                    query: { $regex: new RegExp(fuzzyPattern, 'i') }
                });

                if (cachedDbScrape && cachedDbScrape.enlaces && cachedDbScrape.enlaces.length > 0) {
                    console.log(`[ZYRO] Smart Cache hit en MongoDB para: ${query} (Encontrado como: ${cachedDbScrape.query})`);
                    scrapedLinks = cachedDbScrape.enlaces;
                    requiereScraping = false;
                }
            }

            // 5. WEB SCRAPING Y GUARDADO (Si no hubo hit en BD)
            if (requiereScraping) {
                console.log(`[ZYRO] Iniciando Web Scraping en Bing para: ${query}`);
                try {
                    const queryOptimizada = `${query} ver online gratis`;
                    const scrapeRes = await axios.get(`https://www.bing.com/search?q=${encodeURIComponent(queryOptimizada)}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                        timeout: 8000
                    });

                    const $ = cheerio.load(scrapeRes.data);
                    
                    $('.b_algo').each((i, el) => {
                        const titulo = $(el).find('h2 a').text().trim();
                        const urlDestino = $(el).find('h2 a').attr('href');
                        const descripcion = $(el).find('.b_caption p').text().trim() || "Resultado web scrapeado.";
                        
                        if (titulo && urlDestino) {
                            let dominio = 'Web';
                            try { dominio = new URL(urlDestino).hostname.replace('www.', ''); } catch (e) {}

                            scrapedLinks.push({
                                sitioWeb: dominio,
                                titulo: titulo,
                                descripcion: descripcion,
                                calidad: 'Scraped',
                                urlDestino: urlDestino,
                                categoria: 'Resultados Web',
                                favicon: `https://icon.horse/icon/${dominio}`,
                                isPremium: false
                            });
                        }
                    });

                    // Guardar en la base de datos (Smart Cache)
                    if (db && scrapedLinks.length > 0) {
                        await db.collection('zyro_search_cache').insertOne({
                            query: query.toLowerCase().trim(),
                            enlaces: scrapedLinks,
                            fecha_actualizacion: new Date(),
                            categoria: 'Web Scraping'
                        });
                        console.log(`[ZYRO] Nuevos resultados de Scraping guardados en MongoDB para: ${query}`);
                    }

                } catch (scrapeError) {
                    console.log(`[ZYRO] Fallo en motor de Scraping:`, scrapeError.message);
                }
            }

            // Unir Custom Links + Scraped Links (Paginación simple simulada para el scraper)
            const elementosPorPagina = 15;
            const inicio = (page - 1) * elementosPorPagina;
            const fin = inicio + elementosPorPagina;
            
            enlacesFinales = [...enlacesFinales, ...scrapedLinks.slice(inicio, fin)];

            const respuestaFinal = {
                metadata: page === 1 ? metadata : null,
                sugerencias: sugerencias,
                enlaces: enlacesFinales,
                paginaActual: page,
                fuente: requiereScraping ? 'scraping_live' : 'smart_db_cache'
            };

            // 6. CACHÉ EN RAM POR 24 HORAS (86400 segundos)
            if (enlacesFinales.length > 0) {
                cache.set(cacheKey, respuestaFinal, 86400); 
            } else {
                cache.set(cacheKey, respuestaFinal, 60); // 1 minuto si falló todo
            }
            
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda híbrida:", error);
            res.status(500).json({ 
                metadata: page === 1 ? { tmdb_id: null, titulo: query, tipo: "error", descripcion: "Error interno del servidor." } : null,
                sugerencias: [], enlaces: [], paginaActual: page 
            });
        }
    });
};
