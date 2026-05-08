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

                // Busca patrones de capítulos (Capítulo 1, Episodio 2, 1x01, E01, etc.)
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

            // Caché: 30 mins (1800s) si hay éxito, 30s si falló o no encontró nada útil
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

            // 1. BUSCAR EN TMDB
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

            // 2. METADATA GENÉRICO (Fallback)
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

            // 3. PROVEEDORES OFICIALES
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

            // 4. EL BUSCADOR UNIVERSAL (SearXNG con Rotación y Camuflaje Avanzado)
            try {
                const searxInstances = [
                    'https://searx.be', 
                    'https://search.mdosch.de',
                    'https://searx.tiekoetter.com',
                    'https://searx.work',
                    'https://opnxng.com',
                    'https://priv.au'
                ];

                // Pool de User-Agents más modernos y variados
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
                ];

                const queryModificado = `${query} ver online gratis latino pelicula serie`;
                let searxExito = false;

                for (const instancia of searxInstances) {
                    if (searxExito || enlacesFinales.length >= 15 * page) break;

                    try {
                        const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
                        const searxUrl = `${instancia}/search?q=${encodeURIComponent(queryModificado)}&format=json&pageno=${page}&language=es`;
                        
                        const scraperRes = await axios.get(searxUrl, {
                            timeout: 3500, // Timeout más corto (3.5s) para no hacer esperar al WebView si una bloquea
                            headers: {
                                'User-Agent': randomUserAgent,
                                'Accept': 'application/json, text/plain, */*',
                                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                                'Referer': 'https://www.google.com/',
                                'DNT': '1', // Do Not Track (simula usuario real preocupado por privacidad)
                                'Sec-Fetch-Dest': 'empty',
                                'Sec-Fetch-Mode': 'cors',
                                'Sec-Fetch-Site': 'cross-site'
                            }
                        });

                        const resultados = scraperRes.data.results;
                        
                        if (resultados && resultados.length > 0) {
                            resultados.forEach(res => {
                                if (enlacesFinales.length >= 15 * page) return;

                                let dominio = 'Web';
                                try { 
                                    const urlObj = new URL(res.url);
                                    dominio = urlObj.hostname.replace('www.', ''); 
                                } catch (e) {}

                                const imgIcon = `https://icon.horse/icon/${dominio}`;

                                enlacesFinales.push({
                                    sitioWeb: dominio,
                                    titulo: res.title || "Resultado Web",
                                    descripcion: res.content || `Resultado optimizado para ver "${query}" gratis.`,
                                    calidad: 'SearXNG',
                                    urlDestino: res.url,
                                    categoria: 'Fuentes Alternativas',
                                    favicon: imgIcon,
                                    isPremium: false
                                });
                            });
                            
                            searxExito = true;
                            console.log(`[ZYRO] SearXNG Scraping exitoso en la instancia: ${instancia}`);
                        }
                    } catch (instanciaError) {
                        // Logueamos solo el código de error para no saturar tu terminal de MongoDB
                        const status = instanciaError.response ? instanciaError.response.status : 'Timeout/Error de red';
                        console.log(`[ZYRO] SearXNG falló en ${instancia}: Error ${status}`);
                    }
                }
            } catch (scrapeError) {
                console.log(`[ZYRO] Fallo crítico en el bloque SearXNG para "${query}":`, scrapeError.message);
            }

            // 5. BUSCAR EN TU MONGODB
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

            // 6. EMPAQUETAR Y ENVIAR A ANDROID
            const respuestaFinal = {
                metadata: page === 1 ? metadata : null,
                sugerencias: sugerencias,
                enlaces: enlacesFinales,
                paginaActual: page
            };

            // FIX DEL CACHÉ: 60 segundos si falla, 1 hora (3600 segs) si encuentra enlaces
            if (enlacesFinales.length > 0) {
                cache.set(cacheKey, respuestaFinal, 3600);
            } else {
                console.log(`[ZYRO] Búsqueda vacía para "${query}". Cacheando solo por 60 segs.`);
                cache.set(cacheKey, respuestaFinal, 60);
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
