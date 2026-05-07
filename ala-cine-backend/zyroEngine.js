const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales

module.exports = function(app, getDb, cache, TMDB_API_KEY) {
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
            let anioEstreno = null;

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
                        
                        // Extracción inteligente del año para la UI de Android
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
                    descripcion: `Resultados universales de la red para: "${query}"`,
                    anio: null
                };
            }

            // 4. PROVEEDORES OFICIALES (TMDB Watch Providers)
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

            // 5. EL BUSCADOR UNIVERSAL (Scraping Inteligente Anti-Bloqueos)
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
                            categoria: 'Navegación',
                            isPremium: false
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] Scraping web falló o excedió timeout de 15s para "${query}":`, scrapeError.message);
            }

            // 6. BUSCAR EN TU MONGODB (Prioridad Máxima - Insertar al inicio)
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
                    
                    // Invertimos el orden para que al hacer unshift, el más relevante quede primero
                    customLinks.reverse().forEach(link => {
                        enlacesFinales.unshift({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion || "Enlace destacado y verificado.",
                            calidad: link.calidad || "Premium",
                            urlDestino: link.urlDestino,
                            categoria: link.categoria || "Destacado",
                            isPremium: true // Fundamental para el diseño condicional en Android
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                }
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
                    descripcion: "Hubo un problema procesando la búsqueda.",
                    anio: null
                },
                enlaces: [] 
            });
        }
    });
};
