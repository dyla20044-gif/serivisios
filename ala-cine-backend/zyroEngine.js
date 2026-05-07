const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales

module.exports = function(app, getDb, cache, TMDB_API_KEY) {
    
    // =========================================================================
    // 1. ENDPOINT DE LA BARRA DE BÚSQUEDA (El que ya tenías y funciona perfecto)
    // =========================================================================
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // 1. SISTEMA DE CACHÉ (Evita saturar la web, TMDB y tu Base de Datos)
        const cacheKey = `zyro_universal_${query.toLowerCase().trim()}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${query}`);
            return res.json(cachedResult);
        }

        try {
            let metadata = null;
            let enlacesFinales = [];
            let tmdbId = null;
            let mediaType = 'movie';
            let tituloOficial = query;

            // 2. BUSCAR EN TMDB (Prioridad para Películas o Series)
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
                const results = tmdbRes.data.results;

                if (results && results.length > 0) {
                    const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                    
                    if (bestMatch) {
                        tmdbId = bestMatch.id;
                        mediaType = bestMatch.media_type || 'movie';
                        tituloOficial = bestMatch.title || bestMatch.name;

                        metadata = {
                            tmdb_id: tmdbId,
                            titulo: tituloOficial,
                            poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                            tipo: mediaType,
                            descripcion: bestMatch.overview || "Sin sinopsis disponible."
                        };
                    }
                }
            } catch (tmdbError) {
                console.log("[ZYRO] TMDB no detectó película/serie o falló:", tmdbError.message);
            }

            // 3. METADATA GENÉRICO (Fallback si no es película/serie)
            if (!metadata) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null, 
                    tipo: 'web_search',
                    descripcion: `Resultados universales de la red para: "${query}"`
                };
            }

            // 4. BUSCAR EN TU MONGODB (Enlaces personalizados de la comunidad)
            const db = getDb();
            if (db) {
                const dbQuery = { 
                    $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] 
                };
                if (tmdbId) {
                    dbQuery.$or.push({ tmdb_id: tmdbId });
                }

                try {
                    const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();
                    customLinks.forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion,
                            calidad: link.calidad,
                            urlDestino: link.urlDestino,
                            categoria: link.categoria || "Comunidad"
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                }
            }

            // 5. PROVEEDORES OFICIALES (TMDB Watch Providers)
            if (tmdbId) {
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
                                calidad: "Premium",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales"
                            });
                        });
                    }
                } catch (providerError) {
                    console.log("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 6. EL BUSCADOR UNIVERSAL (Scraping Inteligente Anti-Bloqueos)
            try {
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36'
                ];
                const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                    headers: {
                        'User-Agent': randomUserAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                    },
                    timeout: 15000
                });

                const $ = cheerio.load(scraperRes.data);
                
                $('.result').each((index, element) => {
                    if (index >= 15) return false; 

                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();

                    if (rawTitle && rawUrl) {
                        let cleanUrl = rawUrl;
                        if (rawUrl.includes('uddg=')) {
                            try {
                                const urlObj = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
                                const uddgParam = urlObj.searchParams.get('uddg');
                                if (uddgParam) {
                                    cleanUrl = decodeURIComponent(uddgParam);
                                }
                            } catch (e) {}
                        }

                        if (!cleanUrl.startsWith('http')) return true;

                        let dominio = 'Web';
                        try {
                            dominio = new URL(cleanUrl).hostname.replace('www.', '');
                        } catch (e) {}

                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet || 'Resultado de la web abierta.',
                            calidad: 'Web',
                            urlDestino: cleanUrl,
                            categoria: 'Navegación'
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] Scraping web falló o excedió timeout de 15s para "${query}":`, scrapeError.message);
            }

            // 7. EMPAQUETAR Y ENVIAR A ANDROID
            const respuestaFinal = {
                metadata: metadata,
                enlaces: enlacesFinales
            };

            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ 
                metadata: {
                    tmdb_id: null,
                    titulo: query,
                    poster: null,
                    tipo: "error",
                    descripcion: "Hubo un problema procesando la búsqueda."
                },
                enlaces: [] 
            });
        }
    });

    // =========================================================================
    // 2. NUEVO ENDPOINT: BÚSQUEDA PROFUNDA POR ID (Para los detalles de la peli)
    // =========================================================================
    app.get('/api/zyro-details', async (req, res) => {
        const { tmdbId, mediaType } = req.query; 
        
        if (!tmdbId) return res.status(400).json({ error: "Se requiere tmdbId" });
        const type = mediaType || 'movie';

        // 1. EL CACHÉ: Lo guarda por 2 horas (7200 segundos)
        const cacheKey = `zyro_details_${type}_${tmdbId}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO DETAILS] Sirviendo detalles exactos desde CACHÉ para ID: ${tmdbId}`);
            return res.json(cachedResult);
        }

        console.log(`[ZYRO DETAILS] Buscando red profunda para ID: ${tmdbId}`);

        try {
            let metadata = null;
            let enlacesFinales = [];
            let tituloOficial = "";

            // 2. BUSCAR INFO EXACTA EN TMDB
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`);
                const data = tmdbRes.data;
                tituloOficial = data.title || data.name;

                metadata = {
                    tmdb_id: tmdbId,
                    titulo: tituloOficial,
                    poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
                    tipo: type,
                    descripcion: data.overview || "Sin sinopsis disponible."
                };
            } catch (tmdbError) {
                return res.status(404).json({ error: "No se encontró metadata en TMDB para este ID." });
            }

            // 3. BUSCAR EN TU MONGODB (Uploaders de tu app)
            const db = getDb();
            if (db) {
                try {
                    const customLinks = await db.collection('zyro_custom_links').find({ tmdb_id: parseInt(tmdbId) }).toArray();
                    customLinks.forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion,
                            calidad: link.calidad,
                            urlDestino: link.urlDestino,
                            categoria: link.categoria || "Comunidad"
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO DETAILS] Error en DB:", dbErr.message);
                }
            }

            // 4. EL SCRAPING EN LA WEB (Busca exactamente el título para asegurar precisión)
            try {
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
                ];
                const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

                // Fuerza una búsqueda muy específica en la web
                const searchString = `${tituloOficial} película completa en español latino`; 

                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchString)}`, {
                    headers: { 'User-Agent': randomUA },
                    timeout: 10000 
                });

                const $ = cheerio.load(scraperRes.data);
                
                $('.result').each((index, element) => {
                    if (index >= 8) return false; // Solo los 8 mejores

                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();

                    if (rawTitle && rawUrl) {
                        let cleanUrl = rawUrl;
                        if (rawUrl.includes('uddg=')) {
                            try { cleanUrl = decodeURIComponent(new URL(`https:${rawUrl}`).searchParams.get('uddg')); } catch (e) {}
                        }

                        if (!cleanUrl.startsWith('http')) return true;

                        let dominio = 'Web';
                        try { dominio = new URL(cleanUrl).hostname.replace('www.', ''); } catch (e) {}

                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet,
                            calidad: 'Web',
                            urlDestino: cleanUrl,
                            categoria: 'Exploración de Red'
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO DETAILS] Scraping falló para "${tituloOficial}"`, scrapeError.message);
            }

            // 5. RESPUESTA FINAL Y GUARDADO EN CACHÉ
            const respuestaFinal = {
                metadata: metadata,
                enlaces: enlacesFinales
            };

            cache.set(cacheKey, respuestaFinal, 7200);
            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO DETAILS] Error crítico:", error);
            res.status(500).json({ error: "Error procesando los detalles." });
        }
    });
};
