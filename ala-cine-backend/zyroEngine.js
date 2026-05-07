const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales
const { URLSearchParams } = require('url');

module.exports = function(app, getDb, cache, TMDB_API_KEY) {

    // --- NUEVO ENDPOINT: DEEP SCRAPING ---
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

            const textoBody = $('body').text().toLowerCase();
            const seasonMatches = textoBody.match(/temporada\s*\d+|season\s*\d+/g);
            
            if (seasonMatches) {
                const temporadasUnicas = new Set(seasonMatches.map(s => s.trim()));
                temporadasCount = temporadasUnicas.size;
            } else {
                temporadasCount = $('select option:contains("Temporada"), ul.seasons li, div.season-tab').length;
            }

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

            // Solo cachear por 30 mins si encontró al menos capítulos o fuentes. Si falló, cachea 30 segs.
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

    // --- ENDPOINT ORIGINAL: HOME DINÁMICO ---
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

    // --- ENDPOINT ORIGINAL MODIFICADO: BÚSQUEDA Y PAGINACIÓN ---
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        const page = parseInt(req.query.page) || 1; 
        
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        const cacheKey = `zyro_universal_${query.toLowerCase().trim()}_p${page}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${query} (Página ${page})`);
            return res.json(cachedResult);
        }

        try {
            let metadata = null;
            let enlacesFinales = [];
            let sugerencias = [];
            let tmdbId = null;
            let mediaType = 'movie';
            let tituloOficial = query;
            let anioEstreno = null;

            // 2. BUSCAR EN TMDB
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}&page=${page}`);
                const results = tmdbRes.data.results;

                if (results && results.length > 0) {
                    sugerencias = results.filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(r => ({
                        titulo: r.title || r.name,
                        imagen: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : 'https://via.placeholder.com/500x750?text=Sin+Poster',
                        anio: (r.release_date || r.first_air_date || '').split('-')[0]
                    }));

                    if (page === 1) { 
                        const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                        
                        if (bestMatch) {
                            tmdbId = bestMatch.id;
                            mediaType = bestMatch.media_type || 'movie';
                            tituloOficial = bestMatch.title || bestMatch.name;
                            
                            if (bestMatch.release_date) anioEstreno = bestMatch.release_date.split('-')[0];
                            else if (bestMatch.first_air_date) anioEstreno = bestMatch.first_air_date.split('-')[0];

                            metadata = {
                                tmdb_id: tmdbId,
                                titulo: tituloOficial,
                                poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                                tipo: mediaType,
                                descripcion: bestMatch.overview || "Sin sinopsis disponible.",
                                anio: anioEstreno
                            };
                        }
                    }
                }
            } catch (tmdbError) {
                console.log("[ZYRO] TMDB falló:", tmdbError.message);
            }

            // 3. METADATA GENÉRICO (Fallback)
            if (!metadata && page === 1) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null, 
                    tipo: 'web_search',
                    descripcion: `Resultados universales de la red para: "${query}"`,
                    anio: null
                };
            }

            // 4. PROVEEDORES OFICIALES
            if (tmdbId && page === 1) {
                try {
                    const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                    const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                    
                    if (ecProviders.flatrate) {
                        ecProviders.flatrate.forEach(provider => {
                            const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                            enlacesFinales.push({
                                sitioWeb: domain,
                                titulo: `Ver en ${provider.provider_name}`,
                                descripcion: `Disponible oficialmente en ${provider.provider_name}.`,
                                calidad: "Oficial",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales",
                                isPremium: false
                            });
                        });
                    }
                } catch (providerError) {
                    console.log("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 5. EL BUSCADOR UNIVERSAL (Cambiado a BING para evitar bloqueos del servidor)
            try {
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
                ];
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

                // Generación automática de términos más limpios
                const queryModificado = `${query} ver online gratis latino pelicula serie`;

                // Paginación en Bing (el parámetro 'first' indica desde qué resultado iniciar)
                const startIndex = (page - 1) * 10 + 1;
                const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(queryModificado)}&first=${startIndex}`;

                const scraperRes = await axios.get(bingUrl, {
                    headers: {
                        'User-Agent': randomUserAgent,
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                    },
                    timeout: 15000
                });

                const $ = cheerio.load(scraperRes.data);
                
                $('.b_algo').each((index, element) => {
                    if (enlacesFinales.length >= 15 * page) return false; 

                    const titleElement = $(element).find('h2 a'); 
                    const rawTitle = titleElement.text().trim();
                    const rawUrl = titleElement.attr('href');
                    const snippet = $(element).find('.b_caption p, .b_algoSlug').text().trim();

                    if (rawTitle && rawUrl && rawUrl.startsWith('http')) {
                        let dominio = 'Web';
                        try { 
                            const urlObj = new URL(rawUrl);
                            dominio = urlObj.hostname.replace('www.', ''); 
                        } catch (e) {}

                        const imgIcon = `https://icon.horse/icon/${dominio}`;

                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet || `Resultado optimizado para ver "${query}" gratis.`,
                            calidad: 'Web Scraping',
                            urlDestino: rawUrl,
                            categoria: 'Fuentes Alternativas',
                            favicon: imgIcon,
                            isPremium: false
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] Scraping BING falló para "${query}":`, scrapeError.message);
            }

            // 6. BUSCAR EN TU MONGODB
            if (page === 1) {
                const db = getDb();
                if (db) {
                    const dbQuery = { $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] };
                    if (tmdbId) dbQuery.$or.push({ tmdb_id: tmdbId });

                    try {
                        const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();
                        customLinks.reverse().forEach(link => {
                            enlacesFinales.unshift({
                                sitioWeb: link.sitioWeb,
                                titulo: link.titulo,
                                descripcion: link.descripcion || "Enlace destacado y verificado.",
                                calidad: link.calidad || "Premium",
                                urlDestino: link.urlDestino,
                                categoria: link.categoria || "Destacado",
                                isPremium: true 
                            });
                        });
                    } catch(dbErr) {
                        console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                    }
                }
            }

            // 7. EMPAQUETAR Y ENVIAR A ANDROID
            const respuestaFinal = {
                metadata: page === 1 ? metadata : null,
                sugerencias: sugerencias,
                enlaces: enlacesFinales,
                paginaActual: page
            };

            // FIX DEL CACHÉ: Si no encontró enlaces, solo cachea por 30 segundos (así vuelve a intentar pronto).
            // Si sí encontró enlaces exitosamente, lo cachea por 1 hora (3600 segs).
            if (enlacesFinales.length > 0) {
                cache.set(cacheKey, respuestaFinal, 3600);
            } else {
                console.log(`[ZYRO] Búsqueda vacía para "${query}". Cacheando solo por 30 segs.`);
                cache.set(cacheKey, respuestaFinal, 30);
            }
            
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ 
                metadata: page === 1 ? { tmdb_id: null, titulo: query, tipo: "error", descripcion: "Error." } : null,
                sugerencias: [], enlaces: [], paginaActual: page 
            });
        }
    });
};
